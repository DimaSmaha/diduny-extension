import {
	type FormEvent,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { useTranslation } from "react-i18next";
import { wordCount } from "../../src/core/models";
import type { RetentionCategory, RetentionPolicy } from "../../src/core/ports";
import { DEFAULT_TYPING_SPEED_WPM } from "../../src/core/settings";
import { isReservedShortcut } from "../../src/core/shortcuts";
import { ConfirmDialog } from "./ConfirmDialog";
import { ShortcutField } from "./ShortcutField";
import { TermListInput } from "./TermListInput";
import {
	audioInputDevices,
	microphonePermissionFailure,
	resolveAudioInput,
} from "./audio-devices";
import { userErrorMessage } from "./errors";
import {
	type UiLocale,
	default as i18n,
	languageName,
	setUiLocale,
	supportedUiLocales,
} from "./i18n";
import { dictationLanguages, ownLanguageName } from "./languages";
import {
	type WorkspaceSettingsSnapshot,
	getWorkspaceSettings,
	resettableSettings,
	updateRetentionPolicy,
	updateWorkspaceSettings,
} from "./settings";
import {
	type ShortcutParts,
	composeShortcut,
	parseShortcut,
} from "./shortcut-editor";

const retentionOptions: ReadonlyArray<{
	labelKey: string;
	value: RetentionPolicy;
}> = [
	{ labelKey: "settings.retention.never", value: "never" },
	{ labelKey: "settings.retention.days7", value: "days7" },
	{ labelKey: "settings.retention.days30", value: "days30" },
	{ labelKey: "settings.retention.days90", value: "days90" },
	{ labelKey: "settings.retention.year1", value: "year1" },
	{ labelKey: "settings.retention.forever", value: "forever" },
];

const MAX_TYPING_SPEED_WPM = 300;

function formatBytes(value: number) {
	const units = ["B", "KB", "MB", "GB", "TB"];
	let amount = value;
	let unit = 0;
	while (amount >= 1024 && unit < units.length - 1) {
		amount /= 1024;
		unit += 1;
	}
	return `${amount.toLocaleString(undefined, {
		maximumFractionDigits: unit === 0 ? 0 : 1,
	})} ${units[unit]}`;
}

function formatDuration(value: number) {
	const seconds = Math.abs(Math.round(value));
	const minutes = Math.floor(seconds / 60);
	return minutes
		? `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`
		: `${seconds}s`;
}

function errorMessage(
	error: unknown,
	t: (key: string, options?: Record<string, unknown>) => string,
) {
	return userErrorMessage(error, t);
}

type MicrophoneAccess =
	| "checking"
	| "denied"
	| "granted"
	| "prompt"
	| "unsupported";

function MicrophoneSettings({
	onSave,
	savedDeviceId,
}: {
	onSave(deviceId: string | null): Promise<void>;
	savedDeviceId: string | null;
}) {
	const { t } = useTranslation();
	const [access, setAccess] = useState<MicrophoneAccess>("checking");
	const [devices, setDevices] = useState<ReturnType<typeof audioInputDevices>>(
		[],
	);
	const [message, setMessage] = useState("");
	const { device, savedDeviceMissing } = resolveAudioInput(
		devices,
		savedDeviceId,
	);

	const inspect = useCallback(async () => {
		if (!navigator.mediaDevices?.enumerateDevices) {
			setAccess("unsupported");
			return;
		}
		try {
			const permission = navigator.permissions?.query
				? await navigator.permissions.query({
						name: "microphone" as PermissionName,
					})
				: null;
			if (permission?.state === "denied") {
				setAccess("denied");
				setDevices([]);
				return;
			}
			if (permission?.state !== "granted") {
				setAccess("prompt");
				setDevices([]);
				return;
			}
			setAccess("granted");
			setDevices(
				audioInputDevices(await navigator.mediaDevices.enumerateDevices()),
			);
		} catch {
			setAccess("prompt");
			setDevices([]);
		}
	}, []);

	useEffect(() => {
		void inspect();
	}, [inspect]);

	async function requestPermission() {
		if (!navigator.mediaDevices?.getUserMedia) {
			setAccess("unsupported");
			return;
		}
		setMessage(t("microphone.requesting"));
		try {
			const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
			for (const track of stream.getTracks()) track.stop();
			setAccess("granted");
			setDevices(
				audioInputDevices(await navigator.mediaDevices.enumerateDevices()),
			);
			setMessage(t("microphone.granted"));
		} catch (error) {
			setAccess(
				microphonePermissionFailure(error) === "denied" ? "denied" : "prompt",
			);
			setMessage(errorMessage(error, t));
		}
	}

	async function saveDevice(value: string) {
		try {
			await onSave(value || null);
			setMessage(t("microphone.preferenceSaved"));
		} catch (error) {
			setMessage(errorMessage(error, t));
		}
	}

	return (
		<section aria-labelledby="microphone-title" className="settings-section">
			<h3 id="microphone-title">{t("microphone.title")}</h3>
			{access === "checking" ? <p>{t("microphone.checking")}</p> : null}
			{access === "prompt" ? (
				<>
					<p>{t("microphone.permissionRequired")}</p>
					<button onClick={() => void requestPermission()} type="button">
						{t("microphone.allow")}
					</button>
				</>
			) : null}
			{access === "denied" ? (
				<p role="alert">{t("microphone.blocked")}</p>
			) : null}
			{access === "unsupported" ? (
				<p role="alert">{t("microphone.unsupported")}</p>
			) : null}
			{access === "granted" && devices.length === 0 ? (
				<p role="alert">{t("microphone.noneAvailable")}</p>
			) : null}
			{access === "granted" && devices.length ? (
				<>
					<label htmlFor="microphone-device">
						{t("microphone.recordingMicrophone")}
						<select
							id="microphone-device"
							onChange={(event) => void saveDevice(event.target.value)}
							value={device?.deviceId ?? ""}
						>
							<option value="">{t("microphone.browserDefault")}</option>
							{devices.map((input) => (
								<option key={input.deviceId} value={input.deviceId}>
									{input.label}
								</option>
							))}
						</select>
					</label>
					{savedDeviceMissing ? (
						<p role="alert">
							{t("microphone.savedUnavailable", { device: device?.label })}
						</p>
					) : null}
				</>
			) : null}
			<button onClick={() => void inspect()} type="button">
				{t("microphone.refresh")}
			</button>
			<p aria-live="polite" className="status">
				{message}
			</p>
		</section>
	);
}

export function SettingsPane({
	onSettingsChanged,
	revision,
}: {
	onSettingsChanged(): void;
	revision: number;
}) {
	const { t } = useTranslation();
	const [snapshot, setSnapshot] = useState<WorkspaceSettingsSnapshot | null>(
		null,
	);
	const [announceLiveTranscript, setAnnounceLiveTranscript] = useState(false);
	const [cleanupEnabled, setCleanupEnabled] = useState(false);
	const [confirmingReset, setConfirmingReset] = useState(false);
	const [fillerWords, setFillerWords] = useState<readonly string[]>([]);
	const [lexicon, setLexicon] = useState<readonly string[]>([]);
	const [message, setMessage] = useState("");
	const [shortcut, setShortcut] = useState<ShortcutParts>({
		key: "",
		modifiers: [],
	});
	const [typingSpeed, setTypingSpeed] = useState("");
	const [uiLocale, setUiLocaleState] = useState<UiLocale>("en");
	const [translationSourceLanguage, setTranslationSourceLanguage] =
		useState("uk");
	const [translationTargetLanguage, setTranslationTargetLanguage] =
		useState("en");
	const [typingTestText, setTypingTestText] = useState("");
	const resetReturnFocus = useRef<HTMLButtonElement>(null);
	// The test runs from the first key to the last, so a pause before saving doesn't count.
	const typingTestTiming = useRef<{ firstAt: number; lastAt: number } | null>(
		null,
	);

	const refresh = useCallback(async () => {
		try {
			const next = await getWorkspaceSettings();
			setSnapshot(next);
			setAnnounceLiveTranscript(next.settings.announceLiveTranscript);
			setCleanupEnabled(next.settings.textCleanupEnabled);
			setShortcut(parseShortcut(next.settings.dictationShortcut));
			setFillerWords(next.settings.fillerWords);
			setLexicon(next.settings.protectedLexicon);
			setTypingSpeed(
				String(
					Math.round(
						next.settings.typingSpeedWordsPerMinute ?? DEFAULT_TYPING_SPEED_WPM,
					),
				),
			);
			setUiLocaleState(next.settings.uiLocale);
			setTranslationSourceLanguage(next.settings.translationSourceLanguage);
			setTranslationTargetLanguage(next.settings.translationTargetLanguage);
		} catch (error) {
			setMessage(errorMessage(error, i18n.t.bind(i18n)));
		}
	}, []);

	useEffect(() => {
		void revision;
		void refresh();
	}, [refresh, revision]);

	async function saveCleanup(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		try {
			const settings = await updateWorkspaceSettings({
				fillerWords,
				protectedLexicon: lexicon,
				textCleanupEnabled: cleanupEnabled,
			});
			setSnapshot((current) => (current ? { ...current, settings } : current));
			setFillerWords(settings.fillerWords);
			setLexicon(settings.protectedLexicon);
			setMessage(t("settings.cleanupSaved"));
			onSettingsChanged();
		} catch (error) {
			setMessage(errorMessage(error, t));
		}
	}

	async function saveRetention(
		category: RetentionCategory,
		policy: RetentionPolicy,
	) {
		try {
			const retention = await updateRetentionPolicy(category, policy);
			setSnapshot((current) => (current ? { ...current, retention } : current));
			setMessage(t("settings.retentionSaved"));
			onSettingsChanged();
		} catch (error) {
			setMessage(errorMessage(error, t));
		}
	}

	async function saveMicrophone(deviceId: string | null) {
		try {
			const settings = await updateWorkspaceSettings({
				microphoneDeviceId: deviceId,
			});
			setSnapshot((current) => (current ? { ...current, settings } : current));
			onSettingsChanged();
		} catch (error) {
			setMessage(errorMessage(error, t));
			throw error;
		}
	}

	async function saveShortcut(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const chord = composeShortcut(shortcut);
		if (!chord) {
			setMessage(t("settings.invalidShortcut"));
			return;
		}
		if (isReservedShortcut(chord)) {
			setMessage(t("settings.reservedShortcut", { shortcut: chord }));
			return;
		}
		try {
			const settings = await updateWorkspaceSettings({
				dictationShortcut: chord,
			});
			setShortcut(parseShortcut(settings.dictationShortcut));
			setSnapshot((current) => (current ? { ...current, settings } : current));
			setMessage(
				t("settings.shortcutSaved", { shortcut: settings.dictationShortcut }),
			);
			onSettingsChanged();
		} catch (error) {
			setMessage(errorMessage(error, t));
		}
	}

	async function saveTranslationLanguages(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		try {
			const settings = await updateWorkspaceSettings({
				translationSourceLanguage,
				translationTargetLanguage,
			});
			setSnapshot((current) => (current ? { ...current, settings } : current));
			setTranslationSourceLanguage(settings.translationSourceLanguage);
			setTranslationTargetLanguage(settings.translationTargetLanguage);
			setMessage(t("settings.translationSaved"));
			onSettingsChanged();
		} catch (error) {
			setMessage(errorMessage(error, t));
		}
	}

	async function saveUiLocale(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		try {
			const settings = await updateWorkspaceSettings({ uiLocale });
			setSnapshot((current) => (current ? { ...current, settings } : current));
			setUiLocaleState(settings.uiLocale);
			await setUiLocale(settings.uiLocale);
			// `t` from this render still speaks the old language; confirm in the new one.
			setMessage(i18n.t("settings.interfaceLanguageSaved"));
			onSettingsChanged();
		} catch (error) {
			setMessage(errorMessage(error, t));
		}
	}

	async function saveAccessibility(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		try {
			const settings = await updateWorkspaceSettings({
				announceLiveTranscript,
			});
			setSnapshot((current) => (current ? { ...current, settings } : current));
			setAnnounceLiveTranscript(settings.announceLiveTranscript);
			setMessage(t("settings.accessibilitySaved"));
			onSettingsChanged();
		} catch (error) {
			setMessage(errorMessage(error, t));
		}
	}

	async function saveTypingSpeed(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const wordsPerMinute = Number(typingSpeed);
		if (
			!Number.isFinite(wordsPerMinute) ||
			wordsPerMinute < 1 ||
			wordsPerMinute > MAX_TYPING_SPEED_WPM
		) {
			setMessage(
				t("settings.invalidTypingSpeed", { max: MAX_TYPING_SPEED_WPM }),
			);
			return;
		}
		try {
			await updateWorkspaceSettings({
				typingSpeedWordsPerMinute: Math.round(wordsPerMinute),
			});
			await refresh();
			onSettingsChanged();
			setMessage(t("settings.typingSpeedSaved"));
		} catch (error) {
			setMessage(errorMessage(error, t));
		}
	}

	function editTypingTest(value: string) {
		const now = performance.now();
		if (!value.trim()) typingTestTiming.current = null;
		else if (!typingTestTiming.current)
			typingTestTiming.current = { firstAt: now, lastAt: now };
		else typingTestTiming.current.lastAt = now;
		setTypingTestText(value);
	}

	async function saveMeasuredSpeed() {
		const timing = typingTestTiming.current;
		const words = wordCount(typingTestText);
		const seconds = timing ? (timing.lastAt - timing.firstAt) / 1_000 : 0;
		if (!words || seconds <= 0) {
			setMessage(t("settings.typingNeedsWords"));
			return;
		}
		const wordsPerMinute = Math.max(1, Math.round((words * 60) / seconds));
		// Faster than anyone types: the sentence was pasted.
		if (wordsPerMinute > MAX_TYPING_SPEED_WPM) {
			setMessage(t("settings.typingTooFast", { max: MAX_TYPING_SPEED_WPM }));
			return;
		}
		try {
			await updateWorkspaceSettings({
				typingSpeedWordsPerMinute: wordsPerMinute,
			});
			typingTestTiming.current = null;
			setTypingTestText("");
			await refresh();
			onSettingsChanged();
			setMessage(t("settings.typingMeasuredSaved", { speed: wordsPerMinute }));
		} catch (error) {
			setMessage(errorMessage(error, t));
		}
	}

	async function resetSettings() {
		setConfirmingReset(false);
		try {
			const settings = await updateWorkspaceSettings(resettableSettings);
			await setUiLocale(settings.uiLocale);
			await refresh();
			onSettingsChanged();
			setMessage(i18n.t("settings.resetDone"));
		} catch (error) {
			setMessage(errorMessage(error, i18n.t.bind(i18n)));
		}
		queueMicrotask(() => resetReturnFocus.current?.focus());
	}

	function cancelReset() {
		setConfirmingReset(false);
		queueMicrotask(() => resetReturnFocus.current?.focus());
	}

	if (!snapshot) {
		return <p aria-live="polite">{t("settings.loading")}</p>;
	}

	const { settings, stats, storage } = snapshot;
	return (
		<section aria-labelledby="settings-title" className="settings">
			<header>
				<h2 id="settings-title">{t("settings.title")}</h2>
				<button
					className="secondary"
					onClick={() => setConfirmingReset(true)}
					ref={resetReturnFocus}
					type="button"
				>
					{t("settings.reset")}
				</button>
			</header>
			{confirmingReset ? (
				<ConfirmDialog
					body={t("settings.resetConfirm.body")}
					cancelLabel={t("settings.resetConfirm.cancel")}
					confirmLabel={t("settings.resetConfirm.confirm")}
					onCancel={cancelReset}
					onConfirm={() => void resetSettings()}
					title={t("settings.resetConfirm.title")}
				/>
			) : null}

			<section aria-labelledby="cleanup-title" className="settings-section">
				<h3 id="cleanup-title">{t("settings.cleanupTitle")}</h3>
				<form onSubmit={saveCleanup}>
					<label className="checkbox" htmlFor="cleanup-enabled">
						<input
							checked={cleanupEnabled}
							id="cleanup-enabled"
							onChange={(event) => setCleanupEnabled(event.target.checked)}
							type="checkbox"
						/>
						{t("settings.enableCleanup")}
					</label>
					<TermListInput
						hint={t("settings.fillerWordsHint")}
						id="filler-words"
						label={t("settings.fillerWords")}
						onChange={setFillerWords}
						placeholder={t("settings.fillerWordsPlaceholder")}
						terms={fillerWords}
					/>
					<TermListInput
						hint={t("settings.protectedLexiconHint")}
						id="protected-lexicon"
						label={t("settings.protectedLexicon")}
						onChange={setLexicon}
						placeholder={t("settings.protectedLexiconPlaceholder")}
						terms={lexicon}
					/>
					<button type="submit">{t("settings.saveCleanup")}</button>
				</form>
			</section>

			<section
				aria-labelledby="interface-language-title"
				className="settings-section"
			>
				<h3 id="interface-language-title">{t("settings.interfaceLanguage")}</h3>
				<form onSubmit={saveUiLocale}>
					<label htmlFor="ui-locale">
						{t("settings.interfaceLanguage")}
						<select
							id="ui-locale"
							onChange={(event) =>
								setUiLocaleState(event.target.value as UiLocale)
							}
							value={uiLocale}
						>
							{supportedUiLocales.map((locale) => (
								<option key={locale} value={locale}>
									{languageName(locale, locale)}
								</option>
							))}
						</select>
					</label>
					<button type="submit">{t("settings.saveInterfaceLanguage")}</button>
				</form>
			</section>

			<section
				aria-labelledby="accessibility-title"
				className="settings-section"
			>
				<h3 id="accessibility-title">{t("settings.accessibilityTitle")}</h3>
				<form onSubmit={saveAccessibility}>
					<label className="checkbox" htmlFor="announce-live-transcript">
						<input
							checked={announceLiveTranscript}
							id="announce-live-transcript"
							onChange={(event) =>
								setAnnounceLiveTranscript(event.target.checked)
							}
							type="checkbox"
						/>
						{t("settings.announceLive")}
					</label>
					<p>{t("settings.announceLiveDescription")}</p>
					<button type="submit">{t("settings.saveAccessibility")}</button>
				</form>
			</section>

			<MicrophoneSettings
				onSave={saveMicrophone}
				savedDeviceId={settings.microphoneDeviceId}
			/>

			<section aria-labelledby="shortcut-title" className="settings-section">
				<h3 id="shortcut-title">{t("settings.shortcutTitle")}</h3>
				<form onSubmit={saveShortcut}>
					<ShortcutField onChange={setShortcut} value={shortcut} />
					<button type="submit">{t("settings.saveShortcut")}</button>
				</form>
			</section>

			<section
				aria-labelledby="translation-languages-title"
				className="settings-section"
			>
				<h3 id="translation-languages-title">
					{t("settings.translationLanguages")}
				</h3>
				<form onSubmit={saveTranslationLanguages}>
					<label htmlFor="translation-source-language">
						{t("settings.translationSource")}
						<select
							id="translation-source-language"
							onChange={(event) =>
								setTranslationSourceLanguage(event.target.value)
							}
							value={translationSourceLanguage}
						>
							{dictationLanguages.map((language) => (
								<option key={language} value={language}>
									{ownLanguageName(language)}
								</option>
							))}
						</select>
					</label>
					<label htmlFor="translation-target-language">
						{t("settings.translationTarget")}
						<select
							id="translation-target-language"
							onChange={(event) =>
								setTranslationTargetLanguage(event.target.value)
							}
							value={translationTargetLanguage}
						>
							{dictationLanguages.map((language) => (
								<option key={language} value={language}>
									{ownLanguageName(language)}
								</option>
							))}
						</select>
					</label>
					<button type="submit">{t("settings.saveTranslation")}</button>
				</form>
			</section>

			<section aria-labelledby="retention-title" className="settings-section">
				<h3 id="retention-title">{t("settings.retentionTitle")}</h3>
				<p>{t("settings.neverSaveDescription")}</p>
				{(["dictation", "meeting"] as const).map((category) => (
					<label key={category} htmlFor={`retention-${category}`}>
						{category === "dictation"
							? t("settings.dictationAndTranslation")
							: t("settings.meetings")}
						<select
							id={`retention-${category}`}
							onChange={(event) =>
								void saveRetention(
									category,
									event.target.value as RetentionPolicy,
								)
							}
							value={snapshot.retention[category]}
						>
							{retentionOptions.map((option) => (
								<option key={option.value} value={option.value}>
									{t(option.labelKey)}
								</option>
							))}
						</select>
					</label>
				))}
			</section>

			<section aria-labelledby="statistics-title" className="settings-section">
				<h3 id="statistics-title">{t("settings.statisticsTitle")}</h3>
				<p>{t("statistics.recordings", { count: stats.recordingCount })}</p>
				<p>{t("settings.visibleWords", { count: stats.wordCount })}</p>
				<p>
					{t("settings.dictated", {
						duration: formatDuration(stats.dictationDurationSeconds),
					})}
				</p>
				{stats.timeSavedSeconds === null ? null : (
					<p>
						{stats.timeSavedSeconds >= 0
							? t("settings.timeSaved", {
									duration: formatDuration(stats.timeSavedSeconds),
								})
							: t("settings.slowerThanTyping", {
									duration: formatDuration(stats.timeSavedSeconds),
								})}
					</p>
				)}
				<p>{t("settings.typingPrompt")}</p>
				<blockquote className="typing-sentence">
					{t("settings.calibrationText")}
				</blockquote>
				<label htmlFor="typing-test-text">
					{t("settings.typingTestText")}
					<textarea
						aria-describedby="typing-test-hint"
						autoComplete="off"
						id="typing-test-text"
						onChange={(event) => editTypingTest(event.target.value)}
						spellCheck={false}
						value={typingTestText}
					/>
				</label>
				<p className="hint" id="typing-test-hint">
					{t("settings.typingTestHint")}
				</p>
				<button
					disabled={!typingTestText.trim()}
					onClick={() => void saveMeasuredSpeed()}
					type="button"
				>
					{t("settings.saveMeasuredSpeed")}
				</button>
				<form onSubmit={saveTypingSpeed}>
					<label htmlFor="typing-speed">
						{t("settings.typingSpeed")}
						<input
							aria-describedby="typing-speed-hint"
							id="typing-speed"
							inputMode="numeric"
							max={MAX_TYPING_SPEED_WPM}
							min={1}
							onChange={(event) => setTypingSpeed(event.target.value)}
							step={1}
							type="number"
							value={typingSpeed}
						/>
					</label>
					<p className="hint" id="typing-speed-hint">
						{t("settings.typingSpeedHint", {
							average: DEFAULT_TYPING_SPEED_WPM,
						})}
					</p>
					<button type="submit">{t("settings.saveTypingSpeed")}</button>
				</form>
			</section>

			<section aria-labelledby="storage-title" className="settings-section">
				<h3 id="storage-title">{t("settings.storageTitle")}</h3>
				<p>
					{t("settings.usesDisk", { size: formatBytes(storage.usedBytes) })}
				</p>
				<a href="/bff/library/export">{t("settings.downloadExport")}</a>
			</section>

			<p aria-live="polite" className="status">
				{message}
			</p>
		</section>
	);
}
