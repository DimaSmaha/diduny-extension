import { expect, test } from "bun:test";
import {
	changesFromDefaults,
	defaultOnboardingChoices,
	hasPendingChanges,
	parseOnboardingChoices,
} from "./onboarding-choices";

test("defaults produce no changes", () => {
	expect(hasPendingChanges(defaultOnboardingChoices)).toBeFalse();
	expect(changesFromDefaults(defaultOnboardingChoices)).toEqual({
		settings: {},
	});
});

test("only values that differ from the defaults are sent", () => {
	expect(
		changesFromDefaults({
			announceLiveTranscript: true,
			neverSaveRecordings: true,
			textCleanupEnabled: false,
		}),
	).toEqual({
		retention: "never",
		settings: { announceLiveTranscript: true, textCleanupEnabled: false },
	});
});

test("parses stored choices and rejects garbage", () => {
	expect(parseOnboardingChoices(null)).toBeNull();
	expect(parseOnboardingChoices("not json")).toBeNull();
	expect(parseOnboardingChoices("7")).toBeNull();
	expect(
		parseOnboardingChoices(
			'{"neverSaveRecordings":true,"textCleanupEnabled":"x"}',
		),
	).toEqual({
		announceLiveTranscript: defaultOnboardingChoices.announceLiveTranscript,
		neverSaveRecordings: true,
		textCleanupEnabled: defaultOnboardingChoices.textCleanupEnabled,
	});
});
