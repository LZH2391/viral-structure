import argparse
import json
import math
import sys


EVENT_WINDOW_SECONDS = 0.25
PANN_CHUNK_SECONDS = 5.0


def finite_or_none(value):
    try:
        # Librosa 0.11 may return scalar-like numpy arrays for tempo.
        if hasattr(value, "reshape"):
            flattened = value.reshape(-1)
            value = flattened[0] if len(flattened) else None
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


def quantile(values, q):
    import numpy as np

    if values is None or len(values) == 0:
        return 0
    return float(np.quantile(values, q))


def band_energy_ratios(power, freqs):
    import numpy as np

    bands = {
        "sub_20_120": (20, 120),
        "low_120_500": (120, 500),
        "mid_500_2000": (500, 2000),
        "presence_2000_5000": (2000, 5000),
        "high_5000_12000": (5000, 12000),
    }
    total = np.maximum(power.sum(axis=0), 1e-12)
    ratios = {}
    for name, (low, high) in bands.items():
        mask = (freqs >= low) & (freqs < high)
        ratios[name] = power[mask].sum(axis=0) / total
    return ratios


def spectral_entropy(power):
    import numpy as np

    probabilities = power / np.maximum(power.sum(axis=0, keepdims=True), 1e-12)
    return -(probabilities * np.log2(probabilities + 1e-12)).sum(axis=0) / np.log2(probabilities.shape[0])


def build_event_windows(payload):
    import numpy as np

    times = payload["times"]
    duration = payload["duration"]
    rms = payload["rms"]
    harmonic_rms = payload["harmonic_rms"]
    percussive_rms = payload["percussive_rms"]
    centroid = payload["centroid"]
    flatness = payload["flatness"]
    entropy = payload["entropy"]
    onset_env = payload["onset_env"]
    onset_times = payload["onset_times"]
    band_ratios = payload["band_ratios"]

    rms_q18 = quantile(rms, 0.18)
    rms_q35 = quantile(rms, 0.35)
    onset_q85 = quantile(onset_env, 0.85)
    onset_q90 = quantile(onset_env, 0.90)
    onset_q92 = quantile(onset_env, 0.92)
    flat_q75 = quantile(flatness, 0.75)
    entropy_q75 = quantile(entropy, 0.75)

    windows = []
    start = 0.0
    while start < duration:
        end = min(duration, start + EVENT_WINDOW_SECONDS)
        frame_indexes = np.where((times >= start) & (times < end))[0]
        if len(frame_indexes) == 0:
            start += EVENT_WINDOW_SECONDS
            continue
        onset_indexes = np.where((onset_times >= start) & (onset_times < end))[0]
        onset_peak = float(np.max(onset_env[onset_indexes])) if len(onset_indexes) else 0.0
        rms_mean = float(np.mean(rms[frame_indexes]))
        harmonic_mean = float(np.mean(harmonic_rms[frame_indexes]))
        percussive_mean = float(np.mean(percussive_rms[frame_indexes]))
        flatness_mean = float(np.mean(flatness[frame_indexes]))
        entropy_mean = float(np.mean(entropy[frame_indexes]))
        low_ratio = float(np.mean(band_ratios["sub_20_120"][frame_indexes] + band_ratios["low_120_500"][frame_indexes]))
        window = {
            "start": round(start, 4),
            "end": round(end, 4),
            "rms": round(rms_mean, 7),
            "onsetPeak": round(onset_peak, 4),
            "harmonicRms": round(harmonic_mean, 7),
            "percussiveRms": round(percussive_mean, 7),
            "spectralFlatness": round(flatness_mean, 4),
            "spectralEntropy": round(entropy_mean, 4),
            "centroidHz": round(float(np.mean(centroid[frame_indexes])), 1),
            "bandEnergyRatios": {
                "low": round(low_ratio, 3),
                "mid": round(float(np.mean(band_ratios["mid_500_2000"][frame_indexes])), 3),
                "presence": round(float(np.mean(band_ratios["presence_2000_5000"][frame_indexes])), 3),
                "high": round(float(np.mean(band_ratios["high_5000_12000"][frame_indexes])), 3),
            },
            "labels": [],
        }
        if rms_mean < rms_q18:
            window["labels"].append("silence_or_residual_floor")
        if onset_peak >= onset_q92 and rms_mean >= rms_q35:
            window["labels"].append("strong_cut_candidate")
        elif onset_peak >= onset_q85 and rms_mean >= rms_q35:
            window["labels"].append("weak_cut_candidate")
        if onset_peak >= onset_q90 and percussive_mean > harmonic_mean * 1.15 and rms_mean >= rms_q35:
            window["labels"].append("sfx_candidate")
        if harmonic_mean > percussive_mean * 1.25 and rms_mean >= rms_q35 and entropy_mean < entropy_q75:
            window["labels"].append("music_like")
        if (flatness_mean > max(0.08, flat_q75) or entropy_mean > max(0.72, entropy_q75)) and rms_mean >= rms_q35:
            window["labels"].append("noise_like_or_separation_artifact")
        windows.append(window)
        start += EVENT_WINDOW_SECONDS
    return windows


def build_event_candidates(windows, max_candidates):
    candidates = []
    for window in windows:
        labels = set(window["labels"])
        if not ({"strong_cut_candidate", "weak_cut_candidate", "sfx_candidate"} & labels):
            continue
        if "sfx_candidate" in labels:
            kind = "sfx_candidate"
        elif "strong_cut_candidate" in labels:
            kind = "strong_cut_candidate"
        else:
            kind = "weak_cut_candidate"
        confidence = 0.35
        if "strong_cut_candidate" in labels:
            confidence += 0.25
        if "sfx_candidate" in labels:
            confidence += 0.15
        if "music_like" in labels:
            confidence += 0.05
        if "noise_like_or_separation_artifact" in labels:
            confidence -= 0.2
        if "silence_or_residual_floor" in labels:
            confidence -= 0.25
        confidence = min(0.95, max(0.05, confidence))
        candidates.append({
            "time": round((window["start"] + window["end"]) / 2, 4),
            "start": window["start"],
            "end": window["end"],
            "kind": kind,
            "confidence": round(confidence, 3),
            "usableForEdit": confidence >= 0.5,
            "evidence": {
                "rms": window["rms"],
                "onsetPeak": window["onsetPeak"],
                "harmonicRms": window["harmonicRms"],
                "percussiveRms": window["percussiveRms"],
                "spectralFlatness": window["spectralFlatness"],
                "spectralEntropy": window["spectralEntropy"],
                "bandEnergyRatios": window["bandEnergyRatios"],
                "labels": window["labels"],
            },
        })

    candidates.sort(key=lambda item: (item["confidence"], item["evidence"]["onsetPeak"], item["evidence"]["rms"]), reverse=True)
    filtered = []
    for candidate in candidates:
        if all(abs(candidate["time"] - existing["time"]) >= 0.18 for existing in filtered):
            filtered.append(candidate)
        if len(filtered) >= max_candidates:
            break
    return sorted(filtered, key=lambda item: item["time"])


def merge_regions(windows):
    regions = []
    labels = [
        "music_like",
        "strong_cut_candidate",
        "weak_cut_candidate",
        "sfx_candidate",
        "noise_like_or_separation_artifact",
        "silence_or_residual_floor",
    ]
    for label in labels:
        current = None
        for window in windows:
            active = label in window["labels"]
            if active and current is None:
                current = {
                    "label": label,
                    "start": window["start"],
                    "end": window["end"],
                    "peakRms": window["rms"],
                    "peakOnset": window["onsetPeak"],
                    "count": 1,
                }
            elif active and window["start"] <= current["end"] + EVENT_WINDOW_SECONDS:
                current["end"] = window["end"]
                current["peakRms"] = max(current["peakRms"], window["rms"])
                current["peakOnset"] = max(current["peakOnset"], window["onsetPeak"])
                current["count"] += 1
            elif current is not None:
                regions.append(current)
                current = None
        if current is not None:
            regions.append(current)
    return sorted(regions, key=lambda item: (item["start"], item["label"]))


def classify_with_panns(y, sr, duration, enabled, checkpoint_path):
    if not enabled:
        return {"status": "disabled", "reason": "PANNs classification disabled", "model": "panns-cnn14-audioset", "wholeFileTopLabels": [], "chunks": []}
    try:
        import contextlib
        import io
        import numpy as np
        from pathlib import Path

        data_dir = Path.home() / "panns_data"
        labels_path = data_dir / "class_labels_indices.csv"
        resolved_checkpoint_path = Path(checkpoint_path) if checkpoint_path else data_dir / "Cnn14_mAP=0.431.pth"
        if not labels_path.is_file():
            return {
                "status": "degraded",
                "reason": "PANNs labels file missing; expected class_labels_indices.csv in panns_data",
                "model": "panns-cnn14-audioset",
                "wholeFileTopLabels": [],
                "chunks": [],
            }
        if not resolved_checkpoint_path.is_file():
            return {
                "status": "degraded",
                "reason": "PANNs checkpoint missing; configure pannsCheckpointPath or place Cnn14_mAP=0.431.pth in panns_data",
                "model": "panns-cnn14-audioset",
                "wholeFileTopLabels": [],
                "chunks": [],
            }

        from panns_inference import AudioTagging, labels

        with contextlib.redirect_stdout(io.StringIO()):
            tagger = AudioTagging(checkpoint_path=str(resolved_checkpoint_path), device="cpu")
        audio = y
        if sr != 32000:
            import librosa
            audio = librosa.resample(y, orig_sr=sr, target_sr=32000)
            sr = 32000
        clipwise_output, _ = tagger.inference(audio[None, :].astype(np.float32))
        scores = clipwise_output[0]
        top = np.argsort(scores)[-15:][::-1]
        chunks = []
        chunk_seconds = PANN_CHUNK_SECONDS
        start = 0.0
        while start < duration:
            end = min(duration, start + chunk_seconds)
            segment = audio[int(start * sr):int(end * sr)]
            if len(segment) >= sr // 2:
                output, _ = tagger.inference(segment[None, :].astype(np.float32))
                segment_scores = output[0]
                segment_top = np.argsort(segment_scores)[-10:][::-1]
                chunks.append({
                    "start": round(start, 4),
                    "end": round(end, 4),
                    "topLabels": [{"label": str(labels[index]), "score": round(float(segment_scores[index]), 4)} for index in segment_top],
                })
            start += chunk_seconds
        return {
            "status": "processed",
            "reason": None,
            "model": "panns-cnn14-audioset",
            "wholeFileTopLabels": [{"label": str(labels[index]), "score": round(float(scores[index]), 4)} for index in top],
            "chunks": chunks,
        }
    except Exception as error:
        return {
            "status": "degraded",
            "reason": f"{type(error).__name__}: {error}",
            "model": "panns-cnn14-audioset",
            "wholeFileTopLabels": [],
            "chunks": [],
        }


def main():
    parser = argparse.ArgumentParser(description="Extract low-level audio features with librosa.")
    parser.add_argument("--input", required=True)
    parser.add_argument("--sample-rate", type=int, default=22050)
    parser.add_argument("--hop-length", type=int, default=512)
    parser.add_argument("--n-fft", type=int, default=2048)
    parser.add_argument("--max-energy-frames", type=int, default=240)
    parser.add_argument("--source-role", default="original")
    parser.add_argument("--max-event-candidates", type=int, default=80)
    parser.add_argument("--disable-panns", action="store_true")
    parser.add_argument("--panns-checkpoint-path", default=None)
    args = parser.parse_args()

    import librosa
    import numpy as np

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
    stft = librosa.stft(y, n_fft=args.n_fft, hop_length=args.hop_length)
    magnitude = np.abs(stft) + 1e-12
    power = magnitude ** 2
    flatness = librosa.feature.spectral_flatness(S=magnitude)[0]
    entropy = spectral_entropy(power)
    freqs = librosa.fft_frequencies(sr=sr, n_fft=args.n_fft)
    ratios = band_energy_ratios(power, freqs)
    y_harmonic, y_percussive = librosa.effects.hpss(y)
    harmonic_rms = librosa.feature.rms(y=y_harmonic, frame_length=args.n_fft, hop_length=args.hop_length)[0]
    percussive_rms = librosa.feature.rms(y=y_percussive, frame_length=args.n_fft, hop_length=args.hop_length)[0]
    onset_env = librosa.onset.onset_strength(y=y, sr=sr, hop_length=args.hop_length)
    onset_env_times = librosa.frames_to_time(range(len(onset_env)), sr=sr, hop_length=args.hop_length)
    event_windows = build_event_windows({
        "times": energy_times,
        "duration": duration,
        "rms": rms,
        "harmonic_rms": harmonic_rms,
        "percussive_rms": percussive_rms,
        "centroid": centroid,
        "flatness": flatness,
        "entropy": entropy,
        "onset_env": onset_env,
        "onset_times": onset_env_times,
        "band_ratios": ratios,
    })

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
            "flatnessMean": mean_or_none(flatness),
            "entropyMean": mean_or_none(entropy),
        },
        "audioEventCandidates": build_event_candidates(event_windows, args.max_event_candidates),
        "audioRegions": merge_regions(event_windows),
        "classificationSummary": classify_with_panns(y, sr, duration, not args.disable_panns, args.panns_checkpoint_path),
        "analysisParams": {
            "librosaVersion": getattr(librosa, "__version__", None),
            "sampleRate": sr,
            "hopLength": args.hop_length,
            "nFft": args.n_fft,
            "sourceRole": args.source_role,
            "eventWindowSeconds": EVENT_WINDOW_SECONDS,
            "pannsEnabled": not args.disable_panns,
            "pannsModel": "panns-cnn14-audioset",
            "pannsCheckpointPath": args.panns_checkpoint_path,
        },
    }
    sys.stdout.write(json.dumps(result, ensure_ascii=False, separators=(",", ":")))


if __name__ == "__main__":
    main()
