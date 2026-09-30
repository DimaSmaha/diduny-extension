import { AxeBuilder } from "@axe-core/playwright";
import { type Page, expect, test } from "@playwright/test";
import Fastify from "fastify";
import { chromium } from "playwright";
import { buildServer } from "../server";
import { installSupportedBrowserCapabilities } from "./support/browser-capabilities";
import { createE2eLibrary } from "./support/fake-library";

function serverUrl(server: ReturnType<typeof Fastify>) {
	const address = server.server.address();
	if (!address || typeof address === "string")
		throw new Error("Server did not bind a port");
	return `http://localhost:${address.port}`;
}

async function expectNoAxeViolations(page: Page) {
	const results = await new AxeBuilder({ page })
		.withTags(["wcag2a", "wcag2aa"])
		.analyze();
	expect(results.violations).toEqual([]);
}

async function startStack() {
	const sentEmails: string[] = [];
	const upstream = Fastify();
	upstream.post("/api/v1/auth/send-otp", async (request) => {
		sentEmails.push((request.body as { email: string }).email);
		return {};
	});
	upstream.post("/api/v1/auth/verify-otp", async (request) => ({
		accessToken: "auth-ux-token",
		accessTokenExpiresAt: Date.now() + 300_000,
		refreshToken: "auth-ux-refresh",
		user: { email: (request.body as { email: string }).email },
	}));
	upstream.post("/api/v1/auth/logout", async (_request, reply) =>
		reply.code(204).send(),
	);
	await upstream.listen({ host: "localhost", port: 0 });
	const bff = await buildServer({
		library: createE2eLibrary().library,
		staticDir: new URL("../web/dist", import.meta.url).pathname,
		upstreamUrl: serverUrl(upstream),
	});
	await bff.listen({ host: "localhost", port: 0 });
	const browser = await chromium.launch({
		channel: "chromium",
		headless: true,
	});
	const context = await browser.newContext();
	await installSupportedBrowserCapabilities(context);
	const page = await context.newPage();
	await page.goto(`${serverUrl(bff)}/`);
	return {
		browser,
		page,
		sentEmails,
		async stop() {
			bff.server.closeAllConnections?.();
			upstream.server.closeAllConnections?.();
			await browser.close();
			await bff.close();
			await upstream.close();
		},
	};
}

async function signIn(page: Page, email: string) {
	await page.getByLabel("Email").fill(email);
	await page.getByRole("button", { name: "Send one-time code" }).click();
	await page.getByLabel("One-time code").fill("123456");
	await page.getByRole("button", { name: "Sign in", exact: true }).click();
	await expect(page.getByLabel("Dictation document")).toBeVisible();
}

test("clears the email and code when going back and after a confirmed sign-out", async () => {
	const stack = await startStack();
	const { page } = stack;
	try {
		await page.getByLabel("Email").fill("first@example.com");
		await page.getByRole("button", { name: "Send one-time code" }).click();
		await page.getByLabel("One-time code").fill("654321");
		await page.getByRole("button", { name: "Use another email" }).click();
		await expect(page.getByLabel("Email")).toHaveValue("");
		await expect(page.getByText("Check your inbox")).toHaveCount(0);
		await expect(page.getByText("Sign in to dictate.")).toBeVisible();

		await page.getByLabel("Email").fill("second@example.com");
		await page.getByRole("button", { name: "Send one-time code" }).click();
		await expect(page.getByLabel("One-time code")).toHaveValue("");
		await page.getByLabel("One-time code").fill("123456");
		await page.getByRole("button", { name: "Sign in", exact: true }).click();
		await expect(page.getByText("second@example.com")).toBeVisible();

		const signOut = page.getByRole("button", { name: "Sign out" });
		const dialog = page.getByRole("dialog", { name: "Sign out of Diduny?" });
		await signOut.click();
		await expect(dialog).toBeVisible();
		await expect(
			dialog.getByRole("button", { name: "Stay signed in" }),
		).toBeFocused();
		await expectNoAxeViolations(page);
		await dialog.getByRole("button", { name: "Stay signed in" }).click();
		await expect(dialog).toHaveCount(0);
		await expect(signOut).toBeFocused();

		await signOut.click();
		await page.keyboard.press("Escape");
		await expect(dialog).toHaveCount(0);
		await expect(page.getByLabel("Dictation document")).toBeVisible();

		await signOut.click();
		await dialog.getByRole("button", { name: "Sign out" }).click();
		await expect(page.getByText("Signed out.")).toBeVisible();
		await expect(page.getByLabel("Email")).toHaveValue("");
	} finally {
		await stack.stop();
	}
});

test("submits international addresses that the browser email type would block, unchanged", async () => {
	const stack = await startStack();
	const { page } = stack;
	const addresses = ["I❤️CHOCOLATE🍫@example.com", "користувач@приклад.укр"];
	try {
		for (const address of addresses) {
			await page.getByLabel("Email").fill(address);
			await page.getByRole("button", { name: "Send one-time code" }).click();
			await expect(page.getByLabel("One-time code")).toBeVisible();
			await page.getByRole("button", { name: "Use another email" }).click();
		}
		await page.getByLabel("Email").fill("  simple@project.com \n");
		await page.getByRole("button", { name: "Send one-time code" }).click();
		await expect(page.getByLabel("One-time code")).toBeVisible();

		expect(stack.sentEmails).toEqual([...addresses, "simple@project.com"]);
	} finally {
		await stack.stop();
	}
});

test("explains an invalid address inline without contacting the service", async () => {
	const stack = await startStack();
	const { page } = stack;
	try {
		const email = page.getByLabel("Email");
		for (const address of [
			"abc.example.com",
			"a@b@c@example.com",
			"d@t",
			"test@d.c",
			'"john..doe"@project.com',
		]) {
			await email.fill(address);
			await page.getByRole("button", { name: "Send one-time code" }).click();
			await expect(
				page.getByText("Enter a valid email address", { exact: false }),
			).toBeVisible();
			await expect(email).toHaveAttribute("aria-invalid", "true");
		}
		await expectNoAxeViolations(page);
		await email.fill("simple@project.com");
		await expect(
			page.getByText("Enter a valid email address", { exact: false }),
		).toHaveCount(0);
		expect(stack.sentEmails).toEqual([]);
	} finally {
		await stack.stop();
	}
});

test("theme switcher follows the OS by default, persists a choice, and passes axe in dark mode", async () => {
	const stack = await startStack();
	const { page } = stack;
	const root = page.locator("html");
	const background = () =>
		page.evaluate(() => getComputedStyle(document.body).backgroundColor);
	try {
		const theme = page.getByLabel("Theme");
		await expect(theme).toHaveValue("system");
		await expect(root).not.toHaveAttribute("data-theme");

		await page.emulateMedia({ colorScheme: "dark" });
		expect(await background()).toBe("rgb(22, 21, 20)");
		await expectNoAxeViolations(page);

		await theme.selectOption("light");
		await expect(root).toHaveAttribute("data-theme", "light");
		expect(await background()).toBe("rgb(246, 243, 238)");

		await theme.selectOption("dark");
		await page.emulateMedia({ colorScheme: "light" });
		await page.reload();
		await expect(root).toHaveAttribute("data-theme", "dark");
		await expect(page.getByLabel("Theme")).toHaveValue("dark");
		expect(await background()).toBe("rgb(22, 21, 20)");

		await signIn(page, "theme@example.com");
		await expect(page.getByLabel("Theme")).toHaveValue("dark");
		await expectNoAxeViolations(page);
		await page.getByRole("button", { name: "About delivery" }).click();
		await expectNoAxeViolations(page);
		await page.getByRole("button", { name: "Sign out" }).click();
		await expectNoAxeViolations(page);
	} finally {
		await stack.stop();
	}
});
