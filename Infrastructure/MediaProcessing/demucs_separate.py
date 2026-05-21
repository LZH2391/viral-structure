import sys
from pathlib import Path

import soundfile as sf

import demucs.separate as demucs_separate


def save_audio_without_torchcodec(wav, path, samplerate, clip="rescale", as_float=False, bits_per_sample=16, **_kwargs):
    if clip == "rescale":
        wav = wav / max(wav.abs().max().item(), 1)
    elif clip == "clamp":
        wav = wav.clamp(-1, 1)
    subtype = "FLOAT" if as_float else ("PCM_24" if bits_per_sample == 24 else "PCM_16")
    sf.write(path, wav.detach().cpu().t().numpy(), samplerate, subtype=subtype)


def main():
    demucs_separate.save_audio = save_audio_without_torchcodec
    demucs_separate.main(sys.argv[1:])


if __name__ == "__main__":
    main()
