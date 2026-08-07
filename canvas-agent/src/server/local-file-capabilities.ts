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
    links: number;
    modifiedAt: number;
    changedAt: number;
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
            if (file.isFile() && file.nlink !== 1) return null;
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
            links: file.nlink,
            modifiedAt: file.mtimeMs,
            changedAt: file.ctimeMs,
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
            if (!sameFile(entry, file)) throw new Error("file changed");
            return { ...entry, size: file.size, isDirectory: file.isDirectory() };
        } catch {
            this.entries.delete(handle);
            throw new LocalFileCapabilityError("local_file_handle_expired", "本地文件已变更，请重新运行任务", 410);
        }
    }

    /** Open a capability without following a replaced leaf symlink, then verify the opened inode. */
    async openFile(profileKey: string, reference: string) {
        const entry = this.resolve(profileKey, reference);
        if (entry.isDirectory) throw new LocalFileCapabilityError("local_file_not_file", "本地文件授权不是文件", 400);
        let file: Awaited<ReturnType<typeof fs.promises.open>> | null = null;
        try {
            const noFollow = "O_NOFOLLOW" in fs.constants ? fs.constants.O_NOFOLLOW : 0;
            file = await fs.promises.open(entry.filePath, fs.constants.O_RDONLY | noFollow);
            const opened = await file.stat();
            if (!sameFile(entry, opened) || !opened.isFile()) throw new Error("file changed");
            return { ...entry, size: opened.size, file };
        } catch {
            await file?.close().catch(() => undefined);
            this.entries.delete(entry.handle);
            throw new LocalFileCapabilityError("local_file_handle_expired", "本地文件已变更，请重新运行任务", 410);
        }
    }

    /** Read through the verified descriptor and reject concurrent content changes. */
    async readFile(profileKey: string, reference: string, maxBytes: number) {
        const opened = await this.openFile(profileKey, reference);
        try {
            if (opened.size > maxBytes) throw new LocalFileCapabilityError("local_file_too_large", "本地文件过大", 413);
            const chunks: Buffer[] = [];
            let total = 0;
            while (total <= maxBytes) {
                const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, maxBytes + 1 - total));
                const { bytesRead } = await opened.file.read(chunk, 0, chunk.length, null);
                if (!bytesRead) break;
                chunks.push(chunk.subarray(0, bytesRead));
                total += bytesRead;
            }
            const data = Buffer.concat(chunks, total);
            const after = await opened.file.stat();
            if (data.length > maxBytes) throw new LocalFileCapabilityError("local_file_too_large", "本地文件过大", 413);
            if (!sameFile(opened, after)) throw new LocalFileCapabilityError("local_file_handle_expired", "本地文件已变更，请重新运行任务", 410);
            return { ...opened, file: undefined, data };
        } finally {
            await opened.file.close().catch(() => undefined);
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

function sameFile(entry: LocalFileCapability, file: fs.Stats) {
    return file.dev === entry.device
        && file.ino === entry.inode
        && file.nlink === entry.links
        && file.size === entry.size
        && file.mtimeMs === entry.modifiedAt
        && file.ctimeMs === entry.changedAt
        && file.isDirectory() === entry.isDirectory;
}
