import {
	DEFAULT_DICTATION_SHORTCUT,
	firesInTextFields,
	isReservedShortcut,
	matchesShortcut,
} from "../../src/core/shortcuts";

export const DEFAULT_SHORTCUT = DEFAULT_DICTATION_SHORTCUT;
export const COMMAND_PALETTE_SHORTCUT = "Alt+Shift+P";
export { firesInTextFields, isReservedShortcut };

/** Line placed between separate dictations in the document. */
export const DICTATION_SEPARATOR = "\n---\n";

export function appendTranscript(existing: string, incoming: string) {
	const text = incoming.trim();
	if (!text) return existing;
	const current = existing.trimEnd();
	return current ? `${current}${DICTATION_SEPARATOR}${text}` : text;
}

export function isEditableTarget(target: EventTarget | null) {
	if (!(target instanceof Element)) return false;
	return Boolean(target.closest("input, textarea, [contenteditable='true']"));
}

export function matchesDictationShortcut(
	event: KeyboardEvent,
	shortcut = DEFAULT_SHORTCUT,
) {
	return matchesShortcut(event, shortcut);
}

export function matchesCommandPaletteShortcut(event: KeyboardEvent) {
	return matchesShortcut(event, COMMAND_PALETTE_SHORTCUT);
}
