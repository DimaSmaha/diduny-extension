import { useCallback, useEffect, useRef, useState } from "react";
import { onMessage } from "../../../lib/messaging/bridge";
import type { AudioSource } from "../../../lib/messaging/types";
import { appendTranscript, beginDictation } from "../../../web/src/dictation";

const STORAGE_KEY = "diduny_transcripts";
const stripTags = (s: string) => s.replace(/<\/?(?:end|fin|eos)>/gi, "");

interface SavedTranscript {
	text: string;
	tabText?: string;
	micText?: string;
	timestamp: number;
}

interface SourceState {
	finalText: string;
	interimText: string;
}

export function useTranscript() {
	const [mic, setMic] = useState<SourceState>({
		finalText: "",
		interimText: "",
	});
	const [tab, setTab] = useState<SourceState>({
		finalText: "",
		interimText: "",
	});
	const [copied, setCopied] = useState(false);
	const [history, setHistory] = useState<SavedTranscript[]>([]);
	const micRef = useRef(mic);
	const tabRef = useRef(tab);
	// Sources that have not written anything since the current recording started.
	const awaitingText = useRef(new Set<AudioSource>());
	micRef.current = mic;
	tabRef.current = tab;

	useEffect(() => {
		chrome.storage.local.get(STORAGE_KEY).then((result) => {
			const saved = result[STORAGE_KEY] as SavedTranscript[] | undefined;
			if (saved) setHistory(saved);
		});
	}, []);

	useEffect(() => {
		return onMessage((msg) => {
			if (msg.type === "recording-state-changed" && msg.state === "starting") {
				awaitingText.current = new Set(["mic", "tab"]);
			}

			if (msg.type === "realtime-tokens") {
				const setter = msg.source === "tab" ? setTab : setMic;
				let finalChunk = "";
				let interim = "";
				for (const t of msg.tokens) {
					if (t.is_final) {
						finalChunk += stripTags(t.text);
					} else {
						interim += stripTags(t.text);
					}
				}
				// Each recording starts below a --- line, as in the web app.
				const opensDictation =
					finalChunk.trim() !== "" && awaitingText.current.delete(msg.source);
				setter((prev) => ({
					finalText: opensDictation
						? beginDictation(prev.finalText, finalChunk)
						: prev.finalText + finalChunk,
					interimText: interim,
				}));
			}

			if (msg.type === "transcription-complete") {
				const setter = msg.source === "tab" ? setTab : setMic;
				// The final upload only fills in when nothing streamed during this recording.
				const streamedNothing = awaitingText.current.delete(msg.source);
				setter((prev) => ({
					finalText: streamedNothing
						? appendTranscript(prev.finalText, stripTags(msg.text))
						: prev.finalText,
					interimText: "",
				}));
			}

			if (msg.type === "recording-state-changed" && msg.state === "success") {
				// Save to history when recording completes
				const micState = micRef.current;
				const tabState = tabRef.current;
				const combined = [tabState.finalText, micState.finalText]
					.filter(Boolean)
					.join("\n\n");
				if (combined) {
					const entry: SavedTranscript = {
						text: combined,
						tabText: tabState.finalText || undefined,
						micText: micState.finalText || undefined,
						timestamp: Date.now(),
					};
					setHistory((prev) => {
						const updated = [entry, ...prev].slice(0, 50);
						chrome.storage.local.set({ [STORAGE_KEY]: updated });
						return updated;
					});
				}
			}
		});
	}, []);

	const allText = [tab.finalText, mic.finalText].filter(Boolean).join("\n\n");

	const copyToClipboard = useCallback(async () => {
		if (!allText) return;
		await navigator.clipboard.writeText(allText);
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	}, [allText]);

	const clear = useCallback(() => {
		setMic({ finalText: "", interimText: "" });
		setTab({ finalText: "", interimText: "" });
	}, []);

	// Typed edits become the text later dictation chunks append to.
	const editMic = useCallback((finalText: string) => {
		setMic((prev) => ({ ...prev, finalText }));
	}, []);

	return {
		mic,
		tab,
		allText,
		copied,
		copyToClipboard,
		clear,
		editMic,
		history,
	};
}
