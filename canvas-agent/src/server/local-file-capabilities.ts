import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const HANDLE_PATTERN = /^lf1_[A-Za-z0-9_-]{43}$/;
const CAPABILITY_SCHEME = "canvas-agent-file:";
const DEFAULT_TTL_MS = 10 * 60_000;
const DEFAULT_MAX_ENTRIES = 2_048;

type LocalFileCapability = {
    handle: string;
    profileKey: string;
    workspaceRoot: string;
    filePath: string;
    expiresAt: number;
    size: number;
    isDirectory: boolean;
    device: number;
    inode: number;
};

export class LocalFileCapabilityError extends Error {
    constructor(readonly code: string, message: string, readonly statusCode: number) {
        super(message);
        this.name = "LocalFileCapabilityError";
    }
}

/** Keeps real local paths inside the Agent and exposes only short-lived profile-bound handles. */
export class LocalFileCapabilityRegistry {
    private readonly entries = new Map<string, LocalFileCapability>();
    private readonly now: () => number;
    private readonly ttlMs: number;
    private readonly maxEntries: number;

    constructor(options: { now?: () => number; ttlMs?: number; maxEntries?: number } = {}) {
        this.now = options.now || Date.now;
        this.ttlMs = options.ttlMs || DEFAULT_TTL_MS;
        this.maxEntries = options.maxEntries || DEFAULT_MAX_ENTRIES;
    }

    issue(profileKey: string, workspaceRoot: string, candidate: string) {
        const candidatePath = localPathFromReference(candidate);
        if (!candidatePath) return null;
        let root: string;
        let filePath: string;
        let file: fs.Stats;
        try {
            root = fs.realpathSync(workspaceRoot);
            filePath = fs.realpathSync(candidatePath);
            if (!pathWithin(root, filePath)) return null;
            file = fs.statSync(filePath);
        } catch {
            return null;
        }
        this.prune();
        while (this.entries.size >= this.maxEntries) this.entries.delete(this.entries.keys().next().value || "");
        const handle = `lf1_${crypto.randomBytes(32).toString("base64url")}`;
        this.entries.set(handle, {
            handle,
            profileKey,
            workspaceRoot: root,
            filePath,
            expiresAt: this.now() + this.ttlMs,
            size: file.size,
            isDirectory: file.isDirectory(),
            device: file.dev,
            inode: file.ino,
        });
        return localFileCapabilityURL(handle, path.basename(filePath));
    }

    resolve(profileKey: string, reference: string) {
        this.prune();
        const handle = localFileCapabilityHandle(reference);
        if (!handle) throw new LocalFileCapabilityError("local_file_handle_invalid", "本地文件授权无效", 400);
        const entry = this.entries.get(handle);
        if (!entry) throw new LocalFileCapabilityError("local_file_handle_expired", "本地文件授权已过期，请重新运行任务", 410);
        if (entry.profileKey !== profileKey) throw new LocalFileCapabilityError("local_file_handle_forbidden", "本地文件授权不属于当前账号", 403);
        try {
            const root = fs.realpathSync(entry.workspaceRoot);
            const filePath = fs.realpathSync(entry.filePath);
            const file = fs.statSync(filePath);
            if (root !== entry.workspaceRoot || filePath !== entry.filePath || !pathWithin(root, filePath)) throw new Error("path changed");
            if (entry.device && file.dev !== entry.device || entry.inode && file.ino !== entry.inode) throw new Error("file changed");
            return { ...entry, size: file.size, isDirectory: file.isDirectory() };
        } catch {
            this.entries.delete(handle);
            throw new LocalFileCapabilityError("local_file_handle_expired", "本地文件已变更，请重新运行任务", 410);
        }
    }

    protectPayload(profileKey: string, workspaceRoot: string, value: unknown): unknown {
        if (typeof value === "string") return this.protectText(profileKey, workspaceRoot, value);
        if (Array.isArray(value)) return value.map((item) => this.protectPayload(profileKey, workspaceRoot, item));
        if (!value || typeof value !== "object") return value;
        return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, this.protectPayload(profileKey, workspaceRoot, item)]));
    }

    revokeProfile(profileKey: string) {
        for (const [handle, entry] of this.entries) {
            if (entry.profileKey === profileKey) this.entries.delete(handle);
        }
    }

    clear() {
        this.entries.clear();
    }

    private protectText(profileKey: string, workspaceRoot: string, value: string) {
        const exact = this.issue(profileKey, workspaceRoot, value);
        if (exact) return exact;
        return value.replace(/(!?\[[^\]\r\n]*\]\()([^)\r\n]+)(\))/g, (match, prefix: string, destination: string, suffix: string) => {
            const protectedReference = this.issue(profileKey, workspaceRoot, destination.trim().replace(/^<|>$/g, ""));
            return protectedReference ? `${prefix}${protectedReference}${suffix}` : match;
        });
    }

    private prune() {
        const current = this.now();
        for (const [handle, entry] of this.entries) {
            if (entry.expiresAt <= current) this.entries.delete(handle);
        }
    }
}

export function localFileCapabilityHandle(value: string) {
    const candidate = value.trim();
    if (HANDLE_PATTERN.test(candidate)) return candidate;
    try {
        const url = new URL(candidate);
        if (url.protocol !== CAPABILITY_SCHEME || url.hostname !== "local" || url.username || url.password || url.search || url.hash) return "";
        const handle = decodeURIComponent(url.pathname.split("/").filter(Boolean)[0] || "");
        return HANDLE_PATTERN.test(handle) ? handle : "";
    } catch {
        return "";
    }
}

function localFileCapabilityURL(handle: string, name: string) {
    return `${CAPABILITY_SCHEME}//local/${encodeURIComponent(handle)}/${encodeURIComponent(name || "file")}`;
}

function localPathFromReference(value: string) {
    const candidate = value.trim().replace(/^<|>$/g, "");
    if (path.isAbsolute(candidate)) return path.resolve(candidate);
    if (/^[A-Za-z]:[\\/]/.test(candidate)) return path.resolve(candidate);
    if (!candidate.startsWith("file://")) return "";
    try {
        const url = new URL(candidate);
        if (url.protocol !== "file:" || url.hostname && url.hostname !== "localhost" || url.username || url.password || url.search || url.hash) return "";
        return path.resolve(decodeURIComponent(url.pathname));
    } catch {
        return "";
    }
}

function pathWithin(root: string, candidate: string) {
    const relative = path.relative(root, candidate);
    return relative === "" || relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}
