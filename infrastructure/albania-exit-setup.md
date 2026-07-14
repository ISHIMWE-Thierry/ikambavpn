# Albania exit IP (real AL geolocation)

**You cannot make a Finland/Hetzner IP look Albanian** by changing SNI, Duck DNS, or profile names.
Sites like `whatismyip.com` show the **exit server’s public IP**. For Albania (AL), traffic must leave through a **VPS in Tirana** (or an Albanian SOCKS relay).

## Recommended: Albania VPS + 3X-UI (same stack as Finland)

1. Order a KVM in **Tirana** (real datacenter, not “geo IP” on Hetzner):
   - [AVS ISP](https://www.avsisp.com/vps/albania/) — physical RASH DC, test IP `23.133.204.12`
   - [Host.al](https://host.al/vps/) — AS213683 Tirana

2. On the new box:
   ```bash
   curl -fsSL https://tailscale.com/install.sh | sh && tailscale up --ssh
   bash infrastructure/vps-setup.sh   # or copy from Hetzner
   ```
   Create **VLESS + REALITY + TCP** on port **443** (or **43234**), flow `xtls-rprx-vision`, SNI `www.yahoo.com` / dest `tradingview.com:443`.

3. Mirror your user UUIDs (same as Hetzner inbound) — run `infrastructure/migrate-clients.sh` pointed at the Albania panel URL.

4. On Hetzner backend `.env`:
   ```env
   ALBANIA_VPS_IP=<tirana-public-ipv4>
   ALBANIA_VLESS_HOST=<optional-duck-host-if-you-point-dns-here>
   ALBANIA_REALITY_PUBLIC_KEY=<from panel Get New Cert>
   ALBANIA_REALITY_SHORT_ID=<shortId>
   ALBANIA_VLESS_PORT=443
   ALBANIA_REALITY_SNI=www.yahoo.com
   ```
   Redeploy `ikambavpn-api`.

5. **Permanent direct link** (no subscription), after deploy:
   ```
   GET https://ikambavpn.duckdns.org:8443/xui-public/albania-link/USER%40EMAIL
   ```
   Or hand-build:
   ```
   vless://UUID@ALBANIA_IP:443?type=tcp&security=reality&flow=xtls-rprx-vision&pbk=...&fp=chrome&sni=www.yahoo.com&sid=...&spx=#Albania
   ```

6. User imports **only** the 🇦🇱 profile. `whatismyip` should show **Albania**.

## Optional: Duck DNS for Albania

Create `ikamba-al.duckdns.org` → Albania VPS IP (separate from `ikambavpn.duckdns.org` → Finland).
Set `ALBANIA_VLESS_HOST=ikamba-al.duckdns.org`.

## What does NOT work

| Idea | Result |
|------|--------|
| Rename profile “Albania” on Finland server | Still Finnish IP |
| `ikambavpn.duckdns.org` on Finland VPS | Still Finnish IP |
| Cloudflare / REALITY SNI only | Camouflage only, not exit country |
