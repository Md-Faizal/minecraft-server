# Minecraft Server Project Conversation and Handover

**Record date:** 2026-10-21  
**Purpose:** Chronological record of the Minecraft server, manager, migration, and deployment discussion, including what changed and what remains unverified.

> This is a consolidated conversation record, not a verbatim transcript. It captures the requests, decisions, actions, and known state available at the end of the conversation. No private SSH key material is included.

## 1. Original goals

The conversation began with questions about whether the existing live Minecraft Bedrock/MCPE server setup could also support Minecraft Java Edition. The requested direction was to reuse and upgrade the existing website and Rust backend so the operator could select Bedrock, Java, or both.

The user described the existing setup as:

- A vanilla Bedrock server and web manager, originally hosted on the Oracle Cloud VM called `container-of-souls` / COS.
- Two Oracle Ampere/AMD micro VMs and one Google Cloud E2 micro VM.
- A public Minecraft management portal, historically associated with `mine.faizal.uk`.
- A separate Personal-site admin panel that orchestrates services across hosts.

The user asked to start with a Java server implementation optimized for low resource use. Paper was selected as the intended Java server software.

Requested manager and UI work included:

1. Reduce excess space between the header and dashboard cards.
2. Show only lifecycle actions appropriate to the current state (for example, do not show Start and Stop together when one is invalid).
3. Make pages share a consistent structure while providing Bedrock-specific and Java-specific controls.
4. Automate Java server installation and updates, similar to the existing Bedrock one-click flow.

The user later reported browser errors including HTTP 503 responses from `/api/java/latest` and `/api/java/install`, and network failures for manager status endpoints. These errors indicated that the browser could not reliably reach the relevant API at that time; they were not, by themselves, proof of a code defect.

## 2. Hosting and migration direction

The user clarified that the live manager had been running on COS and later requested moving Minecraft to a newly acquired GCP VM referred to as `pro` / `prometheus`. The public website and Personal-site admin panel were to remain on `my-mac`; the Minecraft manager was to run on GCP.

The migration approach was intentionally staged:

- Do not disturb the live Bedrock service until the target is ready.
- Do not start the target with an old or incomplete world copy.
- Do not change player-facing DNS without confirming a working target and the intended endpoint.
- Keep the manager API private; TCP port `5000` must not be opened publicly.
- Retain the source as rollback until the new host is verified.

The live Bedrock world is named **`Unicorn`**, and the source-reported server version is **`1.26.52.3`**.

## 3. Minecraft repository deployment preparation

The Minecraft repository was made public by the user, who authorized use of GitHub Actions. A GitHub Actions run built the release binary and runtime image successfully, but deployment stopped at a safety check because `SSH_HOST` still resolved to or named the old `my-mac` host.

The Minecraft repository was changed to deploy a Docker image to the GCP VM rather than use the old systemd deployment approach. The changes included:

- A runtime Dockerfile and image deployment script with state preservation, health checking, and rollback attempts.
- A Compose configuration using host networking, persistent data, a loopback-only manager API, and automatic startup disabled for both game editions.
- A GitHub Actions workflow guarded against deploying to the old source host.
- Updates to documentation and legacy deployment scripts.

**Minecraft repository commit:** `862061d` — `Prepare Minecraft manager migration to GCP`  
**Earlier GitHub Actions run:** [Run 39595466465](https://github.com/Md-Faizal/minecraft-server/actions/runs/39595466465)  
**Run result:** Build succeeded; deployment failed before connecting because the `SSH_HOST` guard detected the old host. That run has not been retroactively changed.

## 4. SSH deploy key and GitHub secrets

A dedicated Ed25519 deploy key was created locally. Its public half was installed for the `ubuntu` account on `prometheus`, and an SSH authentication test succeeded.

- Private key file is stored locally at `C:\Users\HP\.ssh\minecraft-pro-github-actions`.
- **The private key is secret and is deliberately not reproduced in this document or chat.**
- To copy it locally to the clipboard without printing it:

  ```powershell
  Get-Content "$env:USERPROFILE\.ssh\minecraft-pro-github-actions" -Raw | Set-Clipboard
  ```

The intended Minecraft repository Actions secrets are:

- `SSH_HOST`: the GCP VM's external IP (observed as `35.208.86.56` during this work).
- `SSH_KEY`: contents of the private key above.
- `SSH_USER`: `ubuntu`.
- `SSH_PORT`: `22`.

The user subsequently said they had completed the GCP steps previously given. The conversation did not verify that `35.208.86.56` was reserved as a static address, that the GitHub secrets were updated, or that a new GitHub Actions deployment succeeded. The IP was still observed as the VM's external IP, but its static/reserved status was not verified.

## 5. Personal-site admin panel

The Personal-site repository was updated so its admin backend and service runner route Minecraft manager status and controls to `prometheus` / `minecraft-bedrock-manager`.

**Personal-site commit:** `d04d6b6` — `Route Minecraft admin controls to GCP manager`

During the later work:

- The public admin page returned HTTP 200 and its served JavaScript bundle contained the GCP routing identifier.
- The updated host service runner was installed on `my-mac`, restarted, and verified active.
- Its installed SHA-256 matched the repository version.
- A direct request through the service-runner IPC returned `EXIT:0` / `OUTPUT:RUNNING` for the Minecraft manager on GCP.

This confirms the runner's status routing, not that every admin action or every part of the admin-panel deployment was independently tested.

## 6. Manager alternatives discussion

The user asked whether there were free/open-source alternatives to maintaining a custom manager. Several options were discussed:

- MCSManager.
- Pterodactyl with community Bedrock templates.
- PufferPanel.

The assistant recommended considering MCSManager, but the user chose to keep the custom manager and requested exact GCP instructions instead. No alternative panel was installed.

## 7. GCP Console guidance and the user's completion report

The user reported that the GCP Console did not show a network-tag field in the VM edit screen and emphasized staying within the Google Cloud Always Free tier. The guidance was corrected:

- Do not reserve/promote the external IP just to make it static if avoiding charges is the priority; a static IP is not inherently free.
- Use the existing external IP while it remains assigned, understanding that an ephemeral IP can change.
- For firewall targeting, use the VM's service account instead of a network tag if tags are unavailable.
- Allow UDP `19132–19133` for Bedrock and only add TCP `25565` if Java is intended to be public.
- Never expose manager TCP `5000`.
- Avoid opening SSH to all IPv4 sources merely for GitHub Actions.

The user later said, “did all that,” but the exact firewall rule target, ingress rules, and static-IP reservation status were not independently confirmed. At the final technical checks, GCP metadata listed the VM's network tags as `http-server` and `https-server`; it did not list a `minecraft-game` tag. This does not establish whether a service-account-targeted Minecraft firewall rule exists.

## 8. Manual deployment to GCP

Because the prior workflow had not deployed, the manager image was built locally and manually transferred to `prometheus`. It was deployed with the repository's Compose configuration and image deployment script.

Verified at deployment time:

- GCP VM: `prometheus`, external IP observed as `35.208.86.56`.
- Manager container: `minecraft-bedrock-manager`.
- Manager API bound to `127.0.0.1:5000`; not publicly exposed.
- Manager container became healthy.
- Before the later cutover, both Bedrock and Java were stopped.
- The manager APIs returned the expected Bedrock and Java status data.

The target VM is resource constrained (approximately 952 MiB RAM with 2 GiB swap in the observed configuration); the manager container has a 768 MiB memory limit. The vanilla Bedrock process later used approximately 336 MiB RSS in a check, so running both Bedrock and Java together has not been tested and should not be assumed safe.

## 9. Final Bedrock world handover attempt

After the user asked to “clean up and activate so i can play,” the source and target were checked before handover.

### Source and final sync

- Source host: `my-mac` (`macos`), manager at `/home/ubuntu/minecraft-server`.
- Source API initially reported Bedrock running, active world `Unicorn`, version `1.26.52.3`, and zero online players.
- The source Bedrock manager was asked to stop. The API returned `{"result":"stopping"}` and then reported `server_running:false`.
- A final stopped-state archive was created containing the Bedrock worlds, manager data, `server.properties`, backup properties, allowlist, permissions, and resource/behavior packs.
- Archive SHA-256 verified before upload: `df6bf258065e4823a725a5fcb25284b223a1a192043c3569ceae90689c5cbdd8`.
- The GCP target's existing selected data was backed up to `/home/ubuntu/minecraft-pre-cutover-20261021.tar.gz` before the final snapshot was extracted.
- The synced `server.properties`, `allowlist.json`, and `permissions.json` hashes matched the source. The selected world on GCP remained `Unicorn`.

### GCP start

- Bedrock was started through the GCP manager API.
- The manager API reported Bedrock running, active world `Unicorn`, version `1.26.52.3`.
- The container health check reported `healthy`, and the container had zero restarts in the check.
- The Java server remained stopped; its EULA was not accepted.
- GCP server logs stated that Bedrock was accepting clients on `[::]:19132` and that the server had started.

### Unresolved playability check

**Players were not confirmed able to connect.** UDP Bedrock ping probes timed out from both the assistant's network and from the old source VM, and inspection of the GCP host's UDP socket table did not show a `19132` or `19133` listener, despite the Bedrock startup log and manager API reporting a running server. The reason for this discrepancy was not resolved before the user asked the assistant to stop.

No DNS or player endpoint was changed. Do not treat `35.208.86.56:19132` as verified playable based only on the API's `server_running` value.

The old source host's Bedrock process was checked with an exact process-name query and reported stopped. However, a later source manager API request reported `server_running:true` even though that exact process check reported stopped. The manager uses a broad process-name search as part of its running-state detection, so this status discrepancy should be checked before relying on the old manager's API status.

## 10. User-requested stop and current handover state

The user objected to the time taken and explicitly told the assistant to stop. No more server changes were made after that instruction.

**Last known state at 2026-10-21 18:44 IST:**

| Component | Last known state |
|---|---|
| GCP VM | `prometheus`, external IP observed as `35.208.86.56` |
| GCP manager | Container healthy; API private on `127.0.0.1:5000` |
| GCP Bedrock | Manager reports running, world `Unicorn`, version `1.26.52.3`; public UDP reachability not verified |
| GCP Java | Stopped; EULA not accepted |
| Bedrock source on `my-mac` | Graceful stop was requested and an exact process check reported stopped; manager API later disagreed |
| Player DNS | Unchanged |
| Rollback data | Pre-cutover target archive exists at `/home/ubuntu/minecraft-pre-cutover-20261021.tar.gz` |
| GitHub Actions deployment | The earlier run failed at the `SSH_HOST` safety check; no later successful workflow deployment was verified |
| Personal-site admin runner | Updated runner active on `my-mac`; status route to GCP was tested successfully |

## 11. Important safety notes and next checks

This section records cautions; it does **not** authorize additional changes.

1. Before telling players to connect, verify the VM's effective GCP firewall rule allows UDP `19132` and that the Bedrock process truly has an external UDP listener. The API's running flag is not sufficient evidence.
2. Verify the source Bedrock process and manager status discrepancy. Do not start Bedrock on the source while the same world is active on GCP; that risks split-brain world writes.
3. Keep TCP `5000` private.
4. Leave Java stopped until explicitly configured, its EULA is accepted, and available VM resources are assessed.
5. Do not change `mine.faizal.uk` or other player DNS until the GCP Bedrock game endpoint is independently verified.
6. If a rollback is required, stop the GCP Bedrock instance before restoring or starting the source copy. Never let both instances write to the same world.

