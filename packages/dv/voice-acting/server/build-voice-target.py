"""Build a Seed-VC target clip for one allowed voice from several clips of that speaker (see voice_target.py).

  python build-voice-target.py --out voices/narrator.wav \
      --seconds 16 clip1.wav clip2.wav ...

Use only clips of a speaker who allowed their voice to be used.
"""
import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import voice_target  # noqa: E402


def main():
    parser = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    parser.add_argument('clips', nargs='+')
    parser.add_argument('--out', required=True)
    parser.add_argument('--seconds', type=float, default=16.0)
    args = parser.parse_args()
    samples, used = voice_target.join_cleanest([(path, voice_target.load(path)) for path in args.clips], args.seconds)
    for label, snr in used:
        print(f'{snr:5.1f} dB  {label}')
    with open(args.out, 'wb') as file:
        file.write(voice_target.wav_bytes(samples))
    print(f'{args.out}: {len(samples) / voice_target.SAMPLE_RATE:.1f} s from {len(used)} clip(s)')


if __name__ == '__main__':
    main()
