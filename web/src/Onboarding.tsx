import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { RetentionPolicy } from "../../src/core/ports";
import { AppBar } from "./ThemeSwitcher";

type MicrophoneState = "denied" | "granted" | "idle" | "unsupported";

export const onboardingCompletedStorageKey = "diduny.onboarding.completed";
export const pendingRetentionStorageKey = "diduny.onboarding.retention";

function DeliveryExplanation() {
	const { t } = useTranslation();
	return (
		<>
			<p>{t("onboarding.delivery.body")}</p>
			<p>{t("onboarding.delivery.extension")}</p>
			<p>{t("onboarding.delivery.clipboardNote")}</p>
		</>
	);
}

/** First-visit page: explains delivery and the engine, then hands off to email sign-in. */
export function StartPage({
	onContinue,
}: {
	onContinue(retention: RetentionPolicy): void;
}) {
	const { t } = useTranslation();
	const [microphone, setMicrophone] = useState<MicrophoneState>("idle");
	const [retention, setRetention] = useState<RetentionPolicy>("forever");

	async function requestMicrophone() {
		if (!navigator.mediaDevices?.getUserMedia) {
			setMicrophone("unsupported");
			return;
		}
		try {
			const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
			for (const track of stream.getTracks()) track.stop();
			setMicrophone("granted");
		} catch {
			setMicrophone("denied");
		}
	}

	return (
		<main className="shell start">
			<AppBar />
			<p className="lead">{t("onboarding.intro")}</p>
			<section aria-labelledby="delivery-title" className="card">
				<h2 id="delivery-title">{t("onboarding.delivery.title")}</h2>
				<DeliveryExplanation />
			</section>
			<section aria-labelledby="provider-title" className="card">
				<h2 id="provider-title">{t("onboarding.provider.title")}</h2>
				<p>{t("onboarding.provider.cloud")}</p>
				<p>{t("onboarding.provider.noSubstitution")}</p>
				<label className="checkbox" htmlFor="onboarding-never-save">
					<input
						checked={retention === "never"}
						id="onboarding-never-save"
						onChange={(event) =>
							setRetention(event.target.checked ? "never" : "forever")
						}
						type="checkbox"
					/>
					{t("onboarding.retention.neverChoice")}
				</label>
				{retention === "never" ? (
					<p className="note">{t("onboarding.retention.neverNote")}</p>
				) : null}
			</section>
			<section aria-labelledby="microphone-title" className="card">
				<h2 id="microphone-title">{t("onboarding.microphone.title")}</h2>
				<p>{t("onboarding.microphone.body")}</p>
				<p className="note">{t("onboarding.microphone.optional")}</p>
				<div className="card-actions">
					<button
						className="secondary"
						disabled={microphone === "granted"}
						onClick={() => void requestMicrophone()}
						type="button"
					>
						{t("onboarding.microphone.allow")}
					</button>
					<p aria-live="polite" className="status">
						{microphone === "granted"
							? t("onboarding.microphone.granted")
							: microphone === "denied"
								? t("onboarding.microphone.denied")
								: microphone === "unsupported"
									? t("onboarding.microphone.unsupported")
									: ""}
					</p>
				</div>
			</section>
			<button
				className="primary"
				onClick={() => onContinue(retention)}
				type="button"
			>
				{t("onboarding.continueToSignIn")}
			</button>
		</main>
	);
}

/** Signed-in, information-only view behind the "About delivery" header button. */
export function AboutDelivery({ onBack }: { onBack(): void }) {
	const { t } = useTranslation();
	const title = useRef<HTMLHeadingElement>(null);

	useEffect(() => {
		title.current?.focus();
	}, []);

	return (
		<section aria-labelledby="about-delivery-title" className="card about">
			<h2 id="about-delivery-title" ref={title} tabIndex={-1}>
				{t("onboarding.delivery.title")}
			</h2>
			<DeliveryExplanation />
			<div>
				<button onClick={onBack} type="button">
					{t("about.back")}
				</button>
			</div>
		</section>
	);
}
