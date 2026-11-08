"""Seed-VC target clips: score speech clips, join the cleanest, and build a speaker's target from VoxCeleb1.

`join_cleanest` trims each clip's leading and trailing silence, scores it by the gap between its speech level and its
noise floor, and joins the cleanest clips best first with 0.2 s of silence until the target reaches the requested
length, levelled to -20 dBFS RMS. `build_from_voxceleb` finds a speaker of VoxCeleb1 by name in `vox1_meta.csv`,
reads only that speaker's clips from `vox1_dev_wav.zip` (or `vox1_test_wav.zip`), from a local folder when one is given
and holds the archive, else from the Hugging Face dataset ProgramComputer/voxceleb with HTTP range requests, keeps the interview that holds the cleanest clip first so the room
sound stays the same, and caches the result as `<cache>/voxceleb1-<id>-<seconds>s.wav`.
"""
import csv
import io
import os

import librosa
import numpy as np
import soundfile

SAMPLE_RATE = 22050
GAP_SEC = 0.2
TARGET_RMS_DB = -20.0
DATASET = 'https://huggingface.co/datasets/ProgramComputer/voxceleb/resolve/main/vox1'


class UnknownSpeaker(LookupError):
    """No VoxCeleb1 speaker has the requested name."""


def score(wave):
    """Speech level (90th percentile of 20 ms RMS) minus noise floor (10th percentile), in dB."""
    frame = int(SAMPLE_RATE * 0.02)
    rms = np.array([np.sqrt(np.mean(wave[i:i + frame] ** 2)) + 1e-9 for i in range(0, len(wave) - frame, frame)])
    db = 20 * np.log10(rms)
    return float(np.percentile(db, 90) - np.percentile(db, 10))


def load(source):
    """A clip as mono 22.05 kHz samples with its silent ends trimmed; `source` is a path or a file object."""
    wave, _ = librosa.load(source, sr=SAMPLE_RATE, mono=True)
    return librosa.effects.trim(wave, top_db=35)[0]


def join_cleanest(clips, seconds):
    """Join the cleanest clips best first, up to `seconds`; the cleanest clip is always used.

    `clips` is a list of (label, samples). Returns (samples, used labels with their scores).
    """
    scored = sorted(((score(wave), label, wave) for label, wave in clips if len(wave) > SAMPLE_RATE // 2),
                    key=lambda item: -item[0])
    if not scored:
        raise ValueError('No clip holds half a second of speech.')
    parts, used, total = [], [], 0.0
    for snr, label, wave in scored:
        if parts and total + len(wave) / SAMPLE_RATE > seconds:
            continue
        parts += [wave, np.zeros(int(SAMPLE_RATE * GAP_SEC), dtype=np.float32)]
        used.append((label, snr))
        total += len(wave) / SAMPLE_RATE + GAP_SEC
    target = np.concatenate(parts[:-1])
    rms = np.sqrt(np.mean(target ** 2)) + 1e-9
    return np.clip(target * (10 ** (TARGET_RMS_DB / 20) / rms), -1, 1), used


def wav_bytes(samples):
    """16-bit PCM WAV bytes of mono 22.05 kHz samples."""
    out = io.BytesIO()
    soundfile.write(out, samples, SAMPLE_RATE, format='WAV', subtype='PCM_16')
    return out.getvalue()


def normalize(name):
    """A speaker name as VoxCeleb1 and a config both write it: lowercase, with spaces for underscores."""
    return ' '.join(name.replace('_', ' ').lower().split())


def speaker(meta_path, name):
    """The (VoxCeleb1 ID, set) of the speaker named `name` in `vox1_meta.csv`."""
    with open(meta_path, newline='') as file:
        for row in csv.DictReader(file, delimiter='\t'):
            if normalize(row['VGGFace1 ID']) == normalize(name):
                return row['VoxCeleb1 ID'].strip(), row['Set'].strip()
    raise UnknownSpeaker(f'VoxCeleb1 has no speaker named "{name}".')


def open_archive(split, local_dir, token):
    """The VoxCeleb1 audio archive of `split`: the local copy in `local_dir` when it holds one, else the remote one."""
    if local_dir:
        path = os.path.join(local_dir, f'vox1_{split}_wav.zip')
        if os.path.exists(path):
            import zipfile
            return zipfile.ZipFile(path)
    from remotezip import RemoteZip
    headers = {'Authorization': f'Bearer {token}'} if token else {}
    return RemoteZip(f'{DATASET}/vox1_{split}_wav.zip', headers=headers)


def build_from_voxceleb(name, seconds, meta_path, cache_dir, token, local_dir=None):
    """The WAV bytes of the speaker's target, the speaker ID and the clips used; built once, then read from the cache."""
    speaker_id, split = speaker(meta_path, name)
    cached = os.path.join(cache_dir, f'voxceleb1-{speaker_id}-{seconds:g}s.wav')
    if os.path.exists(cached):
        with open(cached, 'rb') as file:
            return file.read(), speaker_id, ['cached']
    with open_archive(split, local_dir, token) as archive:
        names = [entry for entry in archive.namelist() if f'/{speaker_id}/' in entry and entry.endswith('.wav')]
        clips = [(entry.split('/', 2)[-1], load(io.BytesIO(archive.read(entry)))) for entry in names]
    if not clips:
        raise UnknownSpeaker(f'VoxCeleb1 holds no clip of "{name}" ({speaker_id}).')
    # Keep the interview of the cleanest clip, so the joined clips share one room and microphone; other interviews only
    # fill a target that it cannot.
    best = max(clips, key=lambda clip: score(clip[1]))[0].split('/')[0]
    session = [clip for clip in clips if clip[0].startswith(best + '/')]
    samples, used = join_cleanest(session, seconds)
    if len(samples) / SAMPLE_RATE < seconds * 0.6:
        samples, used = join_cleanest(clips, seconds)
    data = wav_bytes(samples)
    os.makedirs(cache_dir, exist_ok=True)
    with open(cached + '.partial', 'wb') as file:
        file.write(data)
    os.replace(cached + '.partial', cached)
    return data, speaker_id, [label for label, _ in used]
