import { type LiveText, LiveTranscript } from "./LiveTranscript";

interface SourceProps {
	label: string;
	finalText: string;
}

function SourcePanel({ label, finalText }: SourceProps) {
	if (!finalText) return null;

	return (
		<div className="source-panel">
			<div className="source-label">{label}</div>
			<div className="transcript-text">{finalText}</div>
		</div>
	);
}

interface Props {
	tabText: string;
	micText: string;
	live: LiveText | null;
	copied: boolean;
	onCopy: () => void;
	onClear: () => void;
}

export function MeetingTranscriptView({
	tabText,
	micText,
	live,
	copied,
	onCopy,
	onClear,
}: Props) {
	const hasText = tabText || micText;
	if (!hasText && !live) return null;

	return (
		<div className="transcript">
			{hasText && (
				<>
					<div className="transcript-header">
						<h3>Meeting Transcript</h3>
						<div>
							<button type="button" className="btn btn-ghost" onClick={onCopy}>
								{copied ? "Copied!" : "Copy all"}
							</button>
							<button type="button" className="btn btn-ghost" onClick={onClear}>
								Clear
							</button>
						</div>
					</div>
					<div className="meeting-sources">
						<SourcePanel label="Shared Audio" finalText={tabText} />
						<SourcePanel label="Microphone" finalText={micText} />
					</div>
				</>
			)}
			{live && <LiveTranscript {...live} />}
		</div>
	);
}
