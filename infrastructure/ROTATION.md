# IkambaVPN — IP rotation runbook

Russia eventually blocks any cheap-VPS IP. Rotating is **free** (Hostinger "change
location" gives a new IP on the same plan) and takes about 5 minutes.

## Why users are not interrupted

Shared links point at the **hostname** `ikambavpn.duckdns.org`, not a raw IP, and every
rebuild reuses the **same REALITY keys** (kept in `~/.ikamba/secrets.env`, local, never
committed). So after a rotation the old links still work — DNS just points somewhere new.
Raw-IP copies are also included in the subscription as a fallback for broken-DNS networks;
those do change on rotation, but the hostname ones carry everyone across.

## Rotate (the whole procedure)

1. **hpanel.hostinger.com → VPS → kvm1 → change server location.**
   This assigns a new IP *and wipes the box* (fresh Ubuntu; the SSH key survives).
2. Run, with the new IP:

   ```bash
   bash infrastructure/ikamba-rotate.sh <NEW_IP>
   ```

That repoints DuckDNS, waits for DNS, re-provisions everything with the same keys,
verifies the tunnel and the subscription URL, and confirms the new IP is reachable from
Russia. No further action — existing users reconnect on their own.

## Monitoring

A daily scheduled task (`ikamba-vpn-ru-check`, 10:00 local) runs
`infrastructure/ikamba-ru-check.sh` and reports. It says nothing much while healthy, and
tells you to rotate when Russia starts blocking. Run it manually any time:

```bash
bash infrastructure/ikamba-ru-check.sh
```

Exit codes: `0` healthy · `1` burned/degrading (rotate) · `2` node down (not a RU block).

## What runs on the node

| Port | Purpose |
|------|---------|
| 9443 | VLESS + gRPC + REALITY — **primary**, survives the RU stream-freeze |
| 8448 | VLESS + WebSocket — backup, also freeze-proof |
| 443  | VLESS + TCP + Vision + REALITY — fastest, but freezes in RU without client Fragment |
| 8443 | Caddy serving the subscription (static file + Let's Encrypt cert) |

Plus: BBR tuning, a 2-minute watchdog that restarts xray if a leg stops listening, and
auto-renewing TLS. `infrastructure/ikamba-provision.sh` builds all of it from scratch and
is safe to re-run.

## Notes

- The decoy is `gateway.icloud.com`. Never use a Microsoft host — its TLS cert exceeds
  REALITY's 8192-byte parser limit and the handshake fails silently (Xray issue #6356).
- Keep TCP Fast Open **off** on the inbounds; it corrupts some REALITY handshakes.
- Caddy must run with `auto_https disable_redirects` so it never grabs :443 from the VPN.
