import { MIC_GRANTED_STORAGE_KEY } from "../../lib/audio/microphone";

const btn = document.getElementById("grant") as HTMLButtonElement;
const statusEl = document.getElementById("status") as HTMLElement;

function failureMessage(err: unknown) {
	const name = err instanceof Error ? err.name : "";
	const message = err instanceof Error ? err.message : "";
	if (name === "NotAllowedError" && /dismiss/i.test(message))
		return "The prompt was closed. Click the button again and choose Allow.";
	if (name === "NotAllowedError")
		return "Microphone is blocked for Diduny. Allow it in Chrome's site settings for this extension, then try again.";
	if (name === "NotFoundError")
		return "No microphone found. Connect one and try again.";
	return `Could not access the microphone: ${message || "unknown error"}`;
}

btn.addEventListener("click", async () => {
	try {
		const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
		for (const track of stream.getTracks()) track.stop();
		// Only a real grant is remembered; the background reads this when the tab closes.
		await chrome.storage.local.set({ [MIC_GRANTED_STORAGE_KEY]: true });
		statusEl.className = "success";
		statusEl.textContent = "Microphone access granted! You can close this tab.";
		btn.style.display = "none";
		// Auto-close after a short delay
		setTimeout(() => window.close(), 1500);
	} catch (err) {
		statusEl.className = "error";
		statusEl.textContent = failureMessage(err);
	}
});
