import argparse
import json
import math
import sys


def finite_or_none(value):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(number):
        return None
    return number


def mean_or_none(values):
    if values is None or len(values) == 0:
        return None
    return finite_or_none(values.mean())


def round_time(value):
    number = finite_or_none(value)
    if number is None or number < 0:
        return 0
    return round(number, 4)


def downsample_energy(times, rms_values, max_frames):
    pairs = []
    for time, rms in zip(times, rms_values):
        time_value = finite_or_none(time)
        rms_value = finite_or_none(rms)
        if time_value is None or rms_value is None:
            continue
        pairs.append({"time": round(time_value, 4), "rms": round(rms_value, 6)})
    if max_frames <= 0 or len(pairs) <= max_frames:
        return pairs
    stride = math.ceil(len(pairs) / max_frames)
    return pairs[::stride][:max_frames]


def main():
    parser = argparse.ArgumentParser(description="Extract low-level audio features with librosa.")
    parser.add_argument("--input", required=True)
    parser.add_argument("--sample-rate", type=int, default=22050)
    parser.add_argument("--hop-length", type=int, default=512)
    parser.add_argument("--n-fft", type=int, default=2048)
    parser.add_argument("--max-energy-frames", type=int, default=240)
    parser.add_argument("--source-role", default="original")
    args = parser.parse_args()

    import librosa

    y, sr = librosa.load(args.input, sr=args.sample_rate, mono=True)
    duration = finite_or_none(librosa.get_duration(y=y, sr=sr)) or 0
    tempo, beats = librosa.beat.beat_track(y=y, sr=sr, hop_length=args.hop_length)
    onsets = librosa.onset.onset_detect(y=y, sr=sr, hop_length=args.hop_length, units="time")
    rms = librosa.feature.rms(y=y, frame_length=args.n_fft, hop_length=args.hop_length)[0]
    energy_times = librosa.frames_to_time(range(len(rms)), sr=sr, hop_length=args.hop_length)
    centroid = librosa.feature.spectral_centroid(y=y, sr=sr, n_fft=args.n_fft, hop_length=args.hop_length)[0]
    bandwidth = librosa.feature.spectral_bandwidth(y=y, sr=sr, n_fft=args.n_fft, hop_length=args.hop_length)[0]
    rolloff = librosa.feature.spectral_rolloff(y=y, sr=sr, n_fft=args.n_fft, hop_length=args.hop_length)[0]
    zcr = librosa.feature.zero_crossing_rate(y, frame_length=args.n_fft, hop_length=args.hop_length)[0]

    result = {
        "durationSeconds": round(duration, 4),
        "tempoBpm": finite_or_none(tempo),
        "beats": [round_time(item) for item in librosa.frames_to_time(beats, sr=sr, hop_length=args.hop_length)],
        "onsets": [round_time(item) for item in onsets],
        "energyFrames": downsample_energy(energy_times, rms, args.max_energy_frames),
        "spectralSummary": {
            "centroidMean": mean_or_none(centroid),
            "bandwidthMean": mean_or_none(bandwidth),
            "rolloffMean": mean_or_none(rolloff),
            "zeroCrossingRateMean": mean_or_none(zcr),
        },
        "analysisParams": {
            "librosaVersion": getattr(librosa, "__version__", None),
            "sampleRate": sr,
            "hopLength": args.hop_length,
            "nFft": args.n_fft,
            "sourceRole": args.source_role,
        },
    }
    sys.stdout.write(json.dumps(result, ensure_ascii=False, separators=(",", ":")))


if __name__ == "__main__":
    main()
