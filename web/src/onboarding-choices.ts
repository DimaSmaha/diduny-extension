import type { RetentionPolicy } from "../../src/core/ports";
import { DEFAULT_SETTINGS, type Settings } from "../../src/core/settings";

/** The settings the delivery flow lets you change before or after signing in. */
export interface OnboardingChoices {
	announceLiveTranscript: boolean;
	neverSaveRecordings: boolean;
	textCleanupEnabled: boolean;
}

export const defaultOnboardingChoices: OnboardingChoices = {
	announceLiveTranscript: DEFAULT_SETTINGS.announceLiveTranscript,
	neverSaveRecordings: false,
	textCleanupEnabled: DEFAULT_SETTINGS.textCleanupEnabled,
};

export const pendingChoicesStorageKey = "diduny.onboarding.settings";

export function parseOnboardingChoices(
	raw: string | null,
): OnboardingChoices | null {
	if (!raw) return null;
	try {
		const value = JSON.parse(raw) as Partial<OnboardingChoices> | null;
		if (!value || typeof value !== "object") return null;
		return {
			announceLiveTranscript:
				typeof value.announceLiveTranscript === "boolean"
					? value.announceLiveTranscript
					: defaultOnboardingChoices.announceLiveTranscript,
			neverSaveRecordings: value.neverSaveRecordings === true,
			textCleanupEnabled:
				typeof value.textCleanupEnabled === "boolean"
					? value.textCleanupEnabled
					: defaultOnboardingChoices.textCleanupEnabled,
		};
	} catch {
		return null;
	}
}

/** Only what differs from the defaults, so a returning account isn't overwritten needlessly. */
export function changesFromDefaults(choices: OnboardingChoices): {
	retention?: RetentionPolicy;
	settings: Partial<Settings>;
} {
	const settings: Partial<Settings> = {};
	if (
		choices.announceLiveTranscript !==
		defaultOnboardingChoices.announceLiveTranscript
	)
		settings.announceLiveTranscript = choices.announceLiveTranscript;
	if (
		choices.textCleanupEnabled !== defaultOnboardingChoices.textCleanupEnabled
	)
		settings.textCleanupEnabled = choices.textCleanupEnabled;
	return choices.neverSaveRecordings
		? { retention: "never", settings }
		: { settings };
}

export function hasPendingChanges(choices: OnboardingChoices): boolean {
	const { retention, settings } = changesFromDefaults(choices);
	return retention !== undefined || Object.keys(settings).length > 0;
}
