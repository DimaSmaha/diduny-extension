// RFC 5321/5322 addr-spec with RFC 6531/6532 UTF-8 extensions.
const ATOM_CHAR = String.raw`[A-Za-z0-9!#$%&'*+/=?^_\x60{|}~-]|[^\x00-\x7F\p{White_Space}\p{Cc}]`;
const QUOTED_STRING = String.raw`"(?:[\x20\x21\x23-\x5B\x5D-\x7E]|\\[\x20-\x7E]|[^\x00-\x7F\p{Cc}])*"`;
const WORD = String.raw`(?:(?:${ATOM_CHAR})+|${QUOTED_STRING})`;
const LOCAL_PART = new RegExp(String.raw`^${WORD}(?:\.${WORD})*$`, "u");
const LABEL = String.raw`[\p{L}\p{N}](?:[\p{L}\p{N}\p{M}-]{0,61}[\p{L}\p{N}\p{M}])?`;
const HOSTNAME = new RegExp(String.raw`^${LABEL}(?:\.${LABEL})*$`, "u");
const OCTET = String.raw`(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)`;
const IPV4_LITERAL = new RegExp(String.raw`^\[(?:${OCTET}\.){3}${OCTET}\]$`);
const IPV6_LITERAL = /^\[IPv6:([0-9A-Fa-f:.]+)\]$/i;

const MAX_ADDRESS_OCTETS = 254;
const MAX_LOCAL_PART_OCTETS = 64;
const MAX_HOSTNAME_LENGTH = 253;

const utf8 = new TextEncoder();

function octets(value: string) {
	return utf8.encode(value).length;
}

function isIpv6(address: string) {
	if (!address.includes(":")) return false;
	try {
		new URL(`http://[${address}]/`);
		return true;
	} catch {
		return false;
	}
}

function isValidDomain(domain: string) {
	if (IPV4_LITERAL.test(domain)) return true;
	const ipv6 = IPV6_LITERAL.exec(domain);
	if (ipv6) return isIpv6(ipv6[1] ?? "");
	if (domain.length > MAX_HOSTNAME_LENGTH || !HOSTNAME.test(domain))
		return false;
	return !/^\d+$/.test(domain.slice(domain.lastIndexOf(".") + 1));
}

export function isValidEmail(value: unknown): value is string {
	if (typeof value !== "string" || octets(value) > MAX_ADDRESS_OCTETS)
		return false;
	const at = value.lastIndexOf("@");
	if (at < 1) return false;
	const localPart = value.slice(0, at);
	return (
		octets(localPart) <= MAX_LOCAL_PART_OCTETS &&
		LOCAL_PART.test(localPart) &&
		isValidDomain(value.slice(at + 1))
	);
}

/** Trims pasted whitespace and applies the NFC form RFC 6532 recommends. */
export function normalizeEmail(value: string) {
	return value.trim().normalize("NFC");
}

export function isValidOtp(value: unknown): value is string {
	return typeof value === "string" && /^\d{6}$/.test(value);
}
