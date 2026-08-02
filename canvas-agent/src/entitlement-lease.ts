import { EntitlementVerificationError, type PlatformEntitlementClaims } from "./entitlement.js";
import type { AgentTicketAuthorization } from "./pairing-ticket.js";

type Lease = AgentTicketAuthorization & { origin: string; profileKey: string };
type VersionWatermark = Pick<Lease, "origin" | "subject" | "deviceId" | "authorizationVersion">;
type LeaseEndReason = "expired" | "superseded" | "revoked";

/** 维护网站授权在本机运行时中的短期租约和授权版本高水位。 */
export class EntitlementLeaseRegistry {
    private leases = new Map<string, Lease>();
    private watermarks = new Map<string, VersionWatermark>();
    private timers = new Map<string, ReturnType<typeof setTimeout>>();

    constructor(
        private onEnded: (profileKey: string, reason: LeaseEndReason) => void,
        private now: () => number = Date.now,
    ) {}

    /** 接受一次已验证的网站续期；授权版本只能单调前进。 */
    renew(profileKey: string, claims: PlatformEntitlementClaims): AgentTicketAuthorization {
        const next: Lease = {
            profileKey,
            origin: claims.origin,
            subject: claims.sub,
            deviceId: claims.device_id,
            authorizationVersion: claims.authorization_version,
            expiresAt: claims.exp * 1000,
        };
        if (next.expiresAt <= this.now()) throw new EntitlementVerificationError("agent_entitlement_expired", "Agent entitlement has expired");

        const watermark = this.watermarks.get(profileKey);
        if (watermark && !sameIdentity(watermark, next)) throw new EntitlementVerificationError("agent_entitlement_binding_mismatch", "Agent entitlement identity changed");
        if (watermark && next.authorizationVersion < watermark.authorizationVersion) {
            throw new EntitlementVerificationError("agent_entitlement_stale", "Agent entitlement authorization version is stale");
        }

        const current = this.leases.get(profileKey);
        const superseded = Boolean(current && next.authorizationVersion > current.authorizationVersion);
        this.watermarks.set(profileKey, {
            origin: next.origin,
            subject: next.subject,
            deviceId: next.deviceId,
            authorizationVersion: Math.max(watermark?.authorizationVersion || 0, next.authorizationVersion),
        });
        const active = current && current.authorizationVersion === next.authorizationVersion && current.expiresAt > next.expiresAt
            ? current
            : next;
        this.leases.set(profileKey, active);
        this.schedule(profileKey, active);
        if (superseded) this.onEnded(profileKey, "superseded");
        return ticketAuthorization(next);
    }

    /** 校验本机 ticket 仍属于当前有效的网站授权租约。 */
    authorize(profileKey: string, origin: string, authorization: AgentTicketAuthorization | undefined) {
        if (!authorization) return false;
        this.expire(this.now());
        const lease = this.leases.get(profileKey);
        return Boolean(lease
            && lease.origin === origin
            && lease.subject === authorization.subject
            && lease.deviceId === authorization.deviceId
            && lease.authorizationVersion === authorization.authorizationVersion
            && authorization.expiresAt > this.now());
    }

    /** 立即撤销 profile；授权版本高水位保留到进程结束以阻止旧票据回退。 */
    revoke(profileKey: string) {
        if (!this.leases.has(profileKey)) return;
        this.clearTimer(profileKey);
        this.leases.delete(profileKey);
        this.onEnded(profileKey, "revoked");
    }

    /** 清理所有已经到期且未成功续期的会话。 */
    expire(now = this.now()) {
        this.leases.forEach((lease, profileKey) => {
            if (lease.expiresAt > now) return;
            this.clearTimer(profileKey);
            this.leases.delete(profileKey);
            this.onEnded(profileKey, "expired");
        });
    }

    dispose() {
        this.timers.forEach((timer) => clearTimeout(timer));
        this.timers.clear();
        this.leases.clear();
        this.watermarks.clear();
    }

    private schedule(profileKey: string, lease: Lease) {
        this.clearTimer(profileKey);
        const timer = setTimeout(() => {
            if (this.leases.get(profileKey) === lease) this.expire();
        }, Math.max(1, lease.expiresAt - this.now()));
        timer.unref?.();
        this.timers.set(profileKey, timer);
    }

    private clearTimer(profileKey: string) {
        const timer = this.timers.get(profileKey);
        if (timer) clearTimeout(timer);
        this.timers.delete(profileKey);
    }
}

function sameIdentity(left: VersionWatermark, right: Lease) {
    return left.origin === right.origin && left.subject === right.subject && left.deviceId === right.deviceId;
}

function ticketAuthorization(lease: Lease): AgentTicketAuthorization {
    return {
        subject: lease.subject,
        deviceId: lease.deviceId,
        authorizationVersion: lease.authorizationVersion,
        expiresAt: lease.expiresAt,
    };
}
