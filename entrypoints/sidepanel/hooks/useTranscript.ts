import { useCallback, useEffect, useRef, useState } from "react";
import { onMessage } from "../../../lib/messaging/bridge";
import { appendTranscript } from "../../../web/src/dictation";

const STORAGE_KEY = "diduny_transcripts";
const stripTags = (s: string) => s.replace(/<\/?(?:end|fin|eos)>/gi, "");

interface SavedTranscript {
	text: string;
	tabText?: string;
	micText?: string;
	timestamp: number;
}

export interface SourceState {
	/** Finished results plus the user's edits; streamed tokens never land here. */
	finalText: string;
	/** What the current recording has streamed so far, shown in the live box. */
	liveFinal: string;
	liveProvisional: string;
}

const EMPTY_SOURCE: SourceState = {
	finalText: "",
	liveFinal: "",
	liveProvisional: "",
};

const withoutLive = (prev: SourceState): SourceState => ({
	...prev,
	liveFinal: "",
	liveProvisional: "",
});

export function useTranscript() {
	const [mic, setMic] = useState<SourceState>(EMPTY_SOURCE);
	const [tab, setTab] = useState<SourceState>(EMPTY_SOURCE);
	const [copied, setCopied] = useState(false);
	const [history, setHistory] = useState<SavedTranscript[]>([]);
	const micRef = useRef(mic);
	const tabRef = useRef(tab);
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
			if (
				msg.type === "recording-state-changed" &&
				(msg.state === "starting" ||
					msg.state === "idle" ||
					msg.state === "error")
			) {
				setMic(withoutLive);
				setTab(withoutLive);
			}

			if (msg.type === "realtime-tokens") {
				const setter = msg.source === "tab" ? setTab : setMic;
				let finalChunk = "";
				let provisional = "";
				for (const t of msg.tokens) {
					if (t.is_final) {
						finalChunk += stripTags(t.text);
					} else {
						provisional += stripTags(t.text);
					}
				}
				setter((prev) => ({
					...prev,
					liveFinal: prev.liveFinal + finalChunk,
					liveProvisional: provisional,
				}));
			}

			if (msg.type === "transcription-complete") {
				const setter = msg.source === "tab" ? setTab : setMic;
				// Only the post-processed result joins the transcript, below a --- line as in the web app.
				setter((prev) => ({
					finalText: appendTranscript(prev.finalText, stripTags(msg.text)),
					liveFinal: "",
					liveProvisional: "",
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

	// Clears the transcript only; a recording in progress keeps its live text.
	const clear = useCallback(() => {
		setMic((prev) => ({ ...prev, finalText: "" }));
		setTab((prev) => ({ ...prev, finalText: "" }));
	}, []);

	// Typed edits become the text later dictation results append to.
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
