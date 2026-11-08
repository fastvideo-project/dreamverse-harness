"""HTTP server for Seed-VC v1 voice conversion, for the DreamVerse provider plugin @fastvideo/dreamverse-seed-vc.

It loads the Seed-VC v1 speech model (DiT_seed_v2_uvit_whisper_small_wavenet_bigvgan_pruned, 22.05 kHz) once and then
runs the same conversion as `inference.py` for every request, one at a time:

  GET  /health      -> {"model": ..., "sample_rate": 22050}
  POST /v1/convert  JSON {"source": <data URI>, "target": <data URI>, "diffusion_steps": 50,
                          "inference_cfg_rate": 0.7, "seed": 1234}
                    -> audio/wav, with headers x-duration-sec and x-inference-time-s
  POST /v1/voices/build  JSON {"name": "Miles Teller", "seconds": 16}
                    -> audio/wav, the speaker's target clip built from VoxCeleb1 (voice_target.py), with headers
                       x-speaker-id and x-duration-sec; 404 for a name VoxCeleb1 does not hold

`source` is the performance to convert and `target` the voice to convert it to (Seed-VC uses its first 25 s). The
server does not keep a list of voices: the harness plugin config is the whitelist, and it sends each voice's target
clip, or the name whose clip this server builds. Start it with start-seed-vc.sh; see the bundle README for the setup.
"""
import argparse
import base64
import io
import json
import os
import random
import sys
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

SERVER_DIR = os.path.dirname(os.path.abspath(__file__))
MODEL = 'seed-vc-v1-whisper-small-wavenet'
DEFAULT_STEPS = 50
MAX_STEPS = 200
MAX_BODY = 64 * 1024 * 1024


def parse_options():
    """The command line; each path also reads an environment variable, so start-seed-vc.sh can pass them through."""
    parser = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    parser.add_argument('--host', default='0.0.0.0')
    parser.add_argument('--port', type=int, default=int(os.environ.get('SEED_VC_PORT', '8010')))
    parser.add_argument('--seed-vc', default=os.environ.get('SEED_VC_DIR'),
                        help='The Seed-VC checkout (https://github.com/Plachtaa/seed-vc); env SEED_VC_DIR.')
    parser.add_argument('--voxceleb-meta', default=os.environ.get('VOXCELEB_META'),
                        help='vox1_meta.csv of VoxCeleb1, for voices built by name; env VOXCELEB_META.')
    parser.add_argument('--voxceleb-dir', default=os.environ.get('VOXCELEB_DIR'),
                        help='A folder with vox1_dev_wav.zip and vox1_test_wav.zip; without it the clips are read '
                             'from Hugging Face; env VOXCELEB_DIR.')
    parser.add_argument('--voice-cache', default=os.environ.get(
        'VOICE_CACHE', os.path.join(os.path.expanduser('~'), '.cache', 'dv-seed-vc', 'voices')),
                        help='Where built voices are kept; env VOICE_CACHE.')
    options = parser.parse_args()
    if not options.seed_vc or not os.path.isfile(os.path.join(options.seed_vc, 'inference.py')):
        parser.error('--seed-vc (or SEED_VC_DIR) must name a Seed-VC checkout, the folder that holds inference.py.')
    return options


OPTIONS = parse_options()
# inference.py reads its configs and checkpoints by relative path, so the server runs in the checkout.
os.chdir(OPTIONS.seed_vc)
sys.path.insert(0, OPTIONS.seed_vc)
sys.path.insert(1, SERVER_DIR)

import numpy as np  # noqa: E402
import soundfile  # noqa: E402
import torch  # noqa: E402
import torchaudio  # noqa: E402

import inference  # noqa: E402  (Seed-VC's own script; importing it defines the functions without running main)
import voice_target  # noqa: E402

ARGS = argparse.Namespace(
    f0_condition=False, auto_f0_adjust=False, semi_tone_shift=0, checkpoint=None, config=None, fp16=True,
    length_adjust=1.0, diffusion_steps=DEFAULT_STEPS, inference_cfg_rate=0.7, source='', target='', output='',
)
MODELS = inference.load_models(ARGS)
SAMPLE_RATE = MODELS[-1]['sampling_rate']
# inference.main loads the models itself; reuse the loaded ones instead.
inference.load_models = lambda _args: MODELS
LOCK = threading.Lock()
BUILD_LOCK = threading.Lock()


def decode_data_uri(value, field):
    """Return the bytes of a base64 data URI."""
    if not isinstance(value, str) or not value.startswith('data:') or ';base64,' not in value:
        raise ValueError(f'{field} must be a base64 data URI.')
    return base64.b64decode(value.split(';base64,', 1)[1])


def convert(source, target, steps, cfg_rate, seed):
    """Run inference.main on the two clips and return the converted waveform as WAV bytes and its duration."""
    captured = {}

    def save(_path, waveform, sample_rate, **_):
        captured['wave'] = waveform.detach().cpu().numpy().T
        captured['sr'] = sample_rate

    with tempfile.TemporaryDirectory(prefix='seed-vc-') as tmp:
        paths = {}
        for name, data in (('source', source), ('target', target)):
            paths[name] = os.path.join(tmp, name)
            with open(paths[name], 'wb') as file:
                file.write(data)
        args = argparse.Namespace(**{**vars(ARGS), 'source': paths['source'], 'target': paths['target'],
                                     'output': tmp, 'diffusion_steps': steps, 'inference_cfg_rate': cfg_rate})
        with LOCK:
            random.seed(seed)
            np.random.seed(seed % 2**32)
            torch.manual_seed(seed)
            original, torchaudio.save = torchaudio.save, save
            try:
                inference.main(args)
            finally:
                torchaudio.save = original
    out = io.BytesIO()
    soundfile.write(out, captured['wave'], captured['sr'], format='WAV', subtype='PCM_16')
    return out.getvalue(), len(captured['wave']) / captured['sr']


class Handler(BaseHTTPRequestHandler):
    def send(self, status, body, content_type='application/json', headers=None):
        self.send_response(status)
        self.send_header('content-type', content_type)
        self.send_header('content-length', str(len(body)))
        for key, value in (headers or {}).items():
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(body)

    def error(self, status, message):
        self.send(status, json.dumps({'error': message}).encode())

    def do_GET(self):
        if self.path == '/health':
            self.send(200, json.dumps({'model': MODEL, 'sample_rate': SAMPLE_RATE}).encode())
        else:
            self.error(404, f'No route GET {self.path}.')

    def build_voice(self):
        try:
            body = self.read_json()
            name = body.get('name')
            seconds = float(body.get('seconds', 16))
            if not isinstance(name, str) or name.strip() == '':
                raise ValueError('name must be a non-empty string.')
            if not 4 <= seconds <= 25:
                raise ValueError('seconds must be between 4 and 25.')
        except (ValueError, TypeError, json.JSONDecodeError) as problem:
            self.error(400, str(problem))
            return
        if not OPTIONS.voxceleb_meta:
            self.error(501, 'This server builds no voices by name: start it with --voxceleb-meta (VOXCELEB_META).')
            return
        try:
            from huggingface_hub import get_token
            with BUILD_LOCK:
                wav, speaker_id, _ = voice_target.build_from_voxceleb(
                    name, seconds, OPTIONS.voxceleb_meta, OPTIONS.voice_cache, get_token(), OPTIONS.voxceleb_dir)
        except voice_target.UnknownSpeaker as problem:
            self.error(404, str(problem))
            return
        except Exception as problem:  # report the failure to the harness instead of dropping the connection
            self.error(500, f'Building the voice of "{name}" failed: {problem}')
            return
        duration = (len(wav) - 44) / 2 / voice_target.SAMPLE_RATE
        self.send(200, wav, 'audio/wav', {'x-speaker-id': speaker_id, 'x-duration-sec': f'{duration:.3f}'})

    def read_json(self):
        length = int(self.headers.get('content-length') or 0)
        if length <= 0 or length > MAX_BODY:
            raise ValueError(f'The body must be JSON of at most {MAX_BODY} bytes.')
        return json.loads(self.rfile.read(length))

    def do_POST(self):
        if self.path == '/v1/voices/build':
            self.build_voice()
            return
        if self.path != '/v1/convert':
            self.error(404, f'No route POST {self.path}.')
            return
        length = int(self.headers.get('content-length') or 0)
        if length <= 0 or length > MAX_BODY:
            self.error(400, f'The body must be JSON of at most {MAX_BODY} bytes.')
            return
        try:
            body = json.loads(self.rfile.read(length))
            source = decode_data_uri(body.get('source'), 'source')
            target = decode_data_uri(body.get('target'), 'target')
            steps = int(body.get('diffusion_steps', DEFAULT_STEPS))
            cfg_rate = float(body.get('inference_cfg_rate', 0.7))
            seed = int(body['seed']) if body.get('seed') is not None else random.randrange(2**31)
            if not 1 <= steps <= MAX_STEPS:
                raise ValueError(f'diffusion_steps must be between 1 and {MAX_STEPS}.')
        except (ValueError, TypeError, KeyError, json.JSONDecodeError) as problem:
            self.error(400, str(problem))
            return
        start = time.time()
        try:
            wav, duration = convert(source, target, steps, cfg_rate, seed)
        except Exception as problem:  # report the failure to the harness instead of dropping the connection
            self.error(500, f'Conversion failed: {problem}')
            return
        self.send(200, wav, 'audio/wav', {'x-duration-sec': f'{duration:.3f}',
                                          'x-inference-time-s': f'{time.time() - start:.3f}', 'x-seed': str(seed)})

    def log_message(self, fmt, *args):
        sys.stderr.write(f'{self.address_string()} {fmt % args}\n')


if __name__ == '__main__':
    print(f'Seed-VC server ({MODEL}, {SAMPLE_RATE} Hz) on {OPTIONS.host}:{OPTIONS.port}', flush=True)
    ThreadingHTTPServer((OPTIONS.host, OPTIONS.port), Handler).serve_forever()
