import { CanvasSession } from "./session.js";
import { ToolAuthorizationReplayGuard } from "../tool-authorization.js";

/** 按 profile 隔离网页、画布状态、附件、线程事件和工具调用目标。 */
export class CanvasSessionRegistry {
    private sessions = new Map<string, CanvasSession>();
    private replayGuard = new ToolAuthorizationReplayGuard();

    constructor(private readonly options: { now?: () => number } = {}) {}

    session(profileKey: string) {
        let session = this.sessions.get(profileKey);
        if (!session) {
            session = new CanvasSession({ profileKey, replayGuard: this.replayGuard, now: this.options.now });
            this.sessions.set(profileKey, session);
        }
        return session;
    }

    /** 保留旧健康字段，同时提供可单独放入 diagnostics 的聚合状态。 */
    health() {
        const states = [...this.sessions.values()].map((session) => session.health());
        return {
            ok: true,
            hasCanvas: states.some((state) => state.hasCanvas),
            clients: states.reduce((total, state) => total + state.clients, 0),
            codexBusy: states.some((state) => state.codexBusy),
            profiles: this.sessions.size,
        };
    }

    get codexBusy() {
        return [...this.sessions.values()].some((session) => session.codexBusy);
    }

    get runtimeBusy() {
        return [...this.sessions.values()].some((session) => session.runtimeBusy);
    }

    /** 终止并删除单个 profile，不影响其他已授权网页会话。 */
    disposeProfile(profileKey: string, reason = "Sneeai Agent authorization expired") {
        const session = this.sessions.get(profileKey);
        if (!session) return false;
        session.dispose(reason);
        this.sessions.delete(profileKey);
        return true;
    }

    dispose() {
        this.sessions.forEach((session) => session.dispose());
        this.sessions.clear();
        this.replayGuard.clear();
    }
}
