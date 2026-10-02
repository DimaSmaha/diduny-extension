import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
	type BrowserContext,
	type Page,
	type Worker,
	test as base,
	expect,
} from "@playwright/test";
import Fastify from "fastify";
import { chromium } from "playwright";
import { buildServer } from "../../server";
import { type MockProxy, buildMockProxy } from "../../src/mock-proxy";
import { installSupportedBrowserCapabilities } from "./browser-capabilities";
import { createE2eLibrary } from "./fake-library";
import { TEST_EMAIL, type UpstreamReply, signIn } from "./web-workspace";

export { expect, TEST_EMAIL };

/** Fixture pages the extension types into, served from a localhost origin it may access. */
const PAGES: Record<string, string> = {
	plain: '<textarea id="message" aria-label="Message"></textarea>',
	delivery: `
		<textarea id="message" aria-label="Message">typed message</textarea>
		<p style="margin-top:200px">Below the message box</p>
		<div id="notes" contenteditable="true" role="textbox" aria-label="Notes">Notes: </div>`,
	fields: `
		<textarea id="readonly" aria-label="Read-only notes" readonly>Read only</textarea>
		<textarea id="disabled" aria-label="Disabled notes" disabled>Disabled</textarea>
		<button id="send" type="button">Send</button>`,
	caret: `
		<textarea id="message" aria-label="Message"></textarea>
		<input id="subject" type="text" aria-label="Subject">
		<div id="notes" contenteditable="true" role="textbox" aria-label="Notes"></div>`,
	"page-b":
		'<h1>Page B</h1><textarea id="message" aria-label="Message"></textarea>',
	meeting: `
		<h1>Meeting</h1>
		<textarea id="chat" aria-label="Chat"></textarea>
		<script>
			const context = new AudioContext();
			const tone = context.createOscillator();
			tone.connect(context.destination);
			tone.start();
		</script>`,
};

/** The same editor markup as e2e/extension-bff.spec.ts, each with an event log. */
const EDITORS: Record<string, string> = {
	contenteditable:
		'<div id="editor" contenteditable="true" role="textbox" aria-label="Contenteditable target">Contenteditable </div>',
	linear:
		'<div id="editor" contenteditable="true" data-placeholder="Write a comment" role="textbox" aria-label="Linear target">Linear </div>',
	notion:
		'<div id="editor" contenteditable="true" data-content-editable-leaf="true" role="textbox" aria-label="Notion target">Notion </div>',
	prosemirror:
		'<div id="editor" class="ProseMirror" contenteditable="true" role="textbox" aria-label="ProseMirror target">ProseMirror </div>',
	slack:
		'<div data-qa="message_input"><div id="editor" contenteditable="true" role="textbox" aria-label="Slack target">Slack </div></div>',
};

function html(title: string, body: string) {
	return `<!doctype html><meta charset="utf-8"><title>${title}</title><body>${body}</body>`;
}

export interface ExtensionOptions {
	colorScheme?: "dark" | "light";
	/** Store the permission page's grant up front; false is a fresh install. */
	micGranted?: boolean;
	/** "allowed" accepts Chrome's microphone prompt; "blocked" denies every prompt. */
	microphone?: "allowed" | "blocked";
	/** The fixture page the first tab shows. */
	page?: string;
	panelViewport?: { height: number; width: number };
	signedIn?: boolean;
	streamLiveTokens?: boolean;
}

export interface ExtensionSession {
	bffUrl: string;
	context: BrowserContext;
	extensionId: string;
	/** The tab whose field receives dictation. */
	fixture: Page;
	/** Holds library saves, so the panel stays on Processing until the returned release is called. */
	holdSaves(): () => void;
	library: ReturnType<typeof createE2eLibrary>;
	mock: MockProxy;
	/** Opens an extension page (`options.html`, `sidepanel.html`) in a new tab. */
	openExtensionPage(path: string): Promise<Page>;
	/** Answers `METHOD /api/v1/...` on the upstream with a fixed reply; null removes it. */
	override(route: string, reply: UpstreamReply | null): void;
	pageUrl(name: string): string;
	editorUrl(name: string): string;
	/** sidepanel.html opened as a tab, as the side panel itself cannot be driven. */
	panel: Page;
	web: Page;
	worker: Worker;
}

/**
 * Tracks every socket, so teardown can drop requests a "hang" behaviour
 * never answers; closeAllConnections() misses pending WebSocket upgrades.
 */
function trackSockets(server: { server: import("node:http").Server }) {
	const sockets = new Set<import("node:net").Socket>();
	server.server.on("connection", (socket) => {
		sockets.add(socket);
		socket.on("close", () => sockets.delete(socket));
	});
	return () => {
		for (const socket of sockets) socket.destroy();
	};
}

function serverUrl(server: ReturnType<typeof Fastify>) {
	const address = server.server.address();
	if (!address || typeof address === "string")
		throw new Error("Server did not bind a port");
	return `http://localhost:${address.port}`;
}

export function recordButton(panel: Page) {
	return panel.locator(".record-btn");
}

export function stateLabel(panel: Page) {
	return panel.locator(".state-label");
}

export function panelTranscript(panel: Page) {
	return panel.getByLabel("Transcript", { exact: true });
}

export function liveBox(panel: Page) {
	return panel.getByRole("region", { name: "Live transcript" });
}

export function deliveryNotice(panel: Page) {
	return panel.locator(".delivery-notice");
}

export function panelError(panel: Page) {
	return panel.locator(".error-msg");
}

/** Clicks Record in the panel tab while another tab stays the active one. */
export async function clickRecord(panel: Page) {
	await recordButton(panel).evaluate((button: HTMLButtonElement) =>
		button.click(),
	);
}

function audioFrames(mock: MockProxy) {
	return mock
		.realtimeFrames()
		.filter((frame) => frame.isBinary && frame.data.length > 0).length;
}

/**
 * Record → Recording... → Stop with `target` as the active tab. Waits for
 * audio to reach the upstream unless `waitForAudio` is false.
 */
export async function dictate(
	session: ExtensionSession,
	{
		end = "Done",
		target = session.fixture,
		waitForAudio = true,
		whileRecording,
	}: {
		end?: string | null;
		target?: Page;
		waitForAudio?: boolean;
		whileRecording?: () => Promise<void>;
	} = {},
) {
	const { mock, panel } = session;
	const framesBefore = audioFrames(mock);
	await target.bringToFront();
	await clickRecord(panel);
	await expect(stateLabel(panel)).toHaveText("Recording...");
	if (waitForAudio)
		await expect.poll(() => audioFrames(mock)).toBeGreaterThan(framesBefore);
	else await target.waitForTimeout(1_000);
	await whileRecording?.();
	await clickRecord(panel);
	if (end) await expect(stateLabel(panel)).toHaveText(end, { timeout: 30_000 });
}

/** The JSON config frames the extension sent to the upstream realtime socket. */
export function realtimeConfigs(mock: MockProxy) {
	return mock
		.realtimeFrames()
		.filter((frame) => !frame.isBinary)
		.flatMap((frame) => {
			try {
				const parsed = JSON.parse(String(frame.data)) as Record<
					string,
					unknown
				>;
				return "audio_format" in parsed ? [parsed] : [];
			} catch {
				return [];
			}
		});
}

/** Runs in the background service worker, as Chrome would on a keyboard shortcut. */
export async function dispatchCommand(worker: Worker, name: string) {
	await worker.evaluate((command) => {
		(
			chrome.commands.onCommand as unknown as {
				dispatch(command: string): void;
			}
		).dispatch(command);
	}, name);
}

/** Sends a runtime message from the background, as the background itself would. */
export async function backgroundMessage(worker: Worker, message: unknown) {
	await worker.evaluate(
		(payload) => chrome.runtime.sendMessage(payload).catch(() => undefined),
		message,
	);
}

export async function badgeText(worker: Worker) {
	return worker.evaluate(() => chrome.action.getBadgeText({}));
}

export async function offscreenOpen(worker: Worker) {
	return worker.evaluate(
		async () =>
			(
				await chrome.runtime.getContexts({
					contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
				})
			).length > 0,
	);
}

export async function storageGet(worker: Worker, key: string) {
	return worker.evaluate(
		async (name) => (await chrome.storage.local.get(name))[name],
		key,
	);
}

export async function storageSet(
	worker: Worker,
	values: Record<string, unknown>,
) {
	await worker.evaluate((items) => chrome.storage.local.set(items), values);
}

/** 'bg:startRecording' lines the background logged, e.g. "mode=voice, lang=en, diarization=false". */
export async function recordingStarts(worker: Worker) {
	const entries = (await storageGet(worker, "diduny_crash_log")) as
		| Array<{ ctx: string; msg: string }>
		| undefined;
	return (entries ?? [])
		.filter(
			(entry) =>
				entry.ctx === "bg:startRecording" && entry.msg.startsWith("mode="),
		)
		.map((entry) => entry.msg);
}

export function micPermissionPages(context: BrowserContext) {
	return context
		.pages()
		.filter((page) => page.url().includes("mic-permission"));
}

/**
 * Records every state label the panel shows and whether the live box was
 * visible with it; read it back with `readStateTrail`.
 */
export async function watchStateTrail(panel: Page) {
	await panel.evaluate(() => {
		const trail: Array<{ label: string; live: boolean }> = [];
		Object.defineProperty(window, "didunyStateTrail", { value: trail });
		const record = () => {
			const label = document.querySelector(".state-label")?.textContent ?? "";
			const live = Boolean(
				document.querySelector('[aria-label="Live transcript"]'),
			);
			const last = trail.at(-1);
			if (!last || last.label !== label || last.live !== live)
				trail.push({ label, live });
		};
		new MutationObserver(record).observe(document.body, {
			characterData: true,
			childList: true,
			subtree: true,
		});
		record();
	});
}

export async function readStateTrail(panel: Page) {
	return panel.evaluate(
		() =>
			(window as unknown as { didunyStateTrail: unknown[] }).didunyStateTrail,
	) as Promise<Array<{ label: string; live: boolean }>>;
}

/** Waits until the panel tab shows the signed-in controls. */
export async function panelSignedIn(panel: Page) {
	const refresh = panel.getByRole("button", { name: "I signed in" });
	await expect(panel.getByText(TEST_EMAIL).or(refresh)).toBeVisible();
	if (await refresh.isVisible()) await refresh.click();
	await expect(panel.getByText(TEST_EMAIL)).toBeVisible();
}

async function startExtension(
	options: ExtensionOptions,
): Promise<ExtensionSession & { close(): Promise<void> }> {
	const mock = await buildMockProxy({
		numberTranscripts: true,
		streamLiveTokens: options.streamLiveTokens ?? false,
	});
	const overrides = new Map<string, UpstreamReply>();
	mock.server.addHook("onRequest", (request, reply, done) => {
		const path = new URL(request.raw.url ?? "", "http://mock.local").pathname;
		const override = overrides.get(`${request.method} ${path}`);
		if (!override) return done();
		reply.code(override.status ?? 200).send(override.body ?? {});
	});
	const dropMockSockets = trackSockets(mock.server);
	await mock.server.listen({ host: "localhost", port: 0 });

	const fixtureServer = Fastify();
	fixtureServer.get("/page/:name", async (request, reply) => {
		const name = (request.params as { name: string }).name;
		const body = PAGES[name];
		if (!body) return reply.code(404).send();
		return reply.type("text/html").send(html(`Fixture ${name}`, body));
	});
	fixtureServer.get("/editor/:name", async (request, reply) => {
		const name = (request.params as { name: string }).name;
		const markup = EDITORS[name];
		if (!markup) return reply.code(404).send();
		return reply.type("text/html").send(
			html(
				`${name} editor`,
				`${markup}
				<output id="events"></output>
				<script>
					const target = document.querySelector('#editor');
					for (const type of ['beforeinput', 'input']) target.addEventListener(type, event => {
						document.querySelector('#events').textContent += type + ':' + event.inputType + ';';
					});
				</script>`,
			),
		);
	});
	await fixtureServer.listen({ host: "localhost", port: 0 });
	const fixtureUrl = serverUrl(fixtureServer);

	const library = createE2eLibrary();
	let gate: Promise<void> | undefined;
	const saveStream = library.library.saveStream.bind(library.library);
	library.library.saveStream = async (...args) => {
		await gate;
		return saveStream(...args);
	};
	const bff = await buildServer({
		library: library.library,
		staticDir: resolve("web/dist"),
		upstreamUrl: serverUrl(mock.server),
	});
	const dropBffSockets = trackSockets(bff);
	await bff.listen({ host: "localhost", port: 0 });
	const bffUrl = serverUrl(bff);

	const userDataDir = await mkdtemp(join(tmpdir(), "diduny-extension-e2e-"));
	const extensionPath = resolve(".output/chrome-mv3");
	const context = await chromium.launchPersistentContext(userDataDir, {
		args: [
			`--disable-extensions-except=${extensionPath}`,
			`--load-extension=${extensionPath}`,
			"--use-fake-device-for-media-stream",
			"--autoplay-policy=no-user-gesture-required",
			(options.microphone ?? "allowed") === "allowed"
				? "--use-fake-ui-for-media-stream"
				: "--deny-permission-prompts",
		],
		channel: "chromium",
		colorScheme: options.colorScheme ?? "light",
		headless: true,
	});
	const close = async () => {
		await context.close();
		dropBffSockets();
		dropMockSockets();
		fixtureServer.server.closeAllConnections?.();
		await bff.close();
		await mock.server.close();
		await fixtureServer.close();
		await rm(userDataDir, { force: true, recursive: true });
	};
	try {
		await installSupportedBrowserCapabilities(context);
		const worker =
			context.serviceWorkers()[0] ??
			(await context.waitForEvent("serviceworker", { timeout: 10_000 }));
		const extensionId = new URL(worker.url()).host;
		await storageSet(worker, {
			didunyBffOrigin: bffUrl,
			...((options.micGranted ?? true) ? { micGranted: true } : {}),
		});

		const fixture = context.pages()[0] ?? (await context.newPage());
		await fixture.goto(`${fixtureUrl}/page/${options.page ?? "plain"}`);
		const web = await context.newPage();
		await web.goto(`${bffUrl}/`);
		if (options.signedIn ?? true) await signIn(web);

		const openExtensionPage = async (path: string) => {
			const page = await context.newPage();
			await page.goto(`chrome-extension://${extensionId}/${path}`);
			return page;
		};
		const panel = await context.newPage();
		if (options.panelViewport)
			await panel.setViewportSize(options.panelViewport);
		await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
		if (options.signedIn ?? true) await panelSignedIn(panel);
		await fixture.bringToFront();

		return {
			bffUrl,
			close,
			context,
			editorUrl: (name) => `${fixtureUrl}/editor/${name}`,
			extensionId,
			fixture,
			holdSaves() {
				let release: () => void = () => {};
				gate = new Promise<void>((resolveGate) => {
					release = () => {
						gate = undefined;
						resolveGate();
					};
				});
				return release;
			},
			library,
			mock,
			openExtensionPage,
			override(route, reply) {
				if (reply) overrides.set(route, reply);
				else overrides.delete(route);
			},
			pageUrl: (name) => `${fixtureUrl}/page/${name}`,
			panel,
			web,
			worker,
		};
	} catch (error) {
		await close();
		throw error;
	}
}

export const test = base.extend<{
	extension: (options?: ExtensionOptions) => Promise<ExtensionSession>;
}>({
	// biome-ignore lint/correctness/noEmptyPattern: Playwright fixtures must destructure their dependencies.
	extension: async ({}, use) => {
		const started: Array<() => Promise<void>> = [];
		await use(async (options = {}) => {
			const session = await startExtension(options);
			started.push(session.close);
			return session;
		});
		for (const close of started.reverse()) await close();
	},
});
