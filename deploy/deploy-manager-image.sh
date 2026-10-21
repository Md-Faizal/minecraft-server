#!/usr/bin/env bash
set -euo pipefail

deploy_dir="/home/ubuntu/minecraft-deploy"
image="minecraft-server-manager:latest"
rollback_image="minecraft-server-manager:rollback"
container="minecraft-bedrock-manager"
archive="${1:-}"

if [[ -z "$archive" || ! -f "$archive" ]]; then
  echo "Usage: $0 /path/to/minecraft-manager-image.tar.gz" >&2
  exit 2
fi

is_true() {
  grep -Eq "\"$2\"[[:space:]]*:[[:space:]]*true" <<< "$1"
}

wait_for_stopped() {
  local endpoint="$1"
  local field="$2"
  local response

  for _ in {1..30}; do
    if ! response="$(curl -fsS --max-time 5 "http://127.0.0.1:5000$endpoint")"; then
      return 1
    fi
    if ! is_true "$response" "$field"; then
      return 0
    fi
    sleep 2
  done

  return 1
}

was_bedrock_running=false
was_java_running=false
previous_image_id="$(docker inspect -f '{{.Image}}' "$container" 2>/dev/null || docker image inspect -f '{{.Id}}' "$image" 2>/dev/null || true)"
if [[ "$(docker inspect -f '{{.State.Running}}' "$container" 2>/dev/null || true)" == "true" ]]; then
  bedrock_status="$(curl -fsS --max-time 5 http://127.0.0.1:5000/api/status)"
  java_status="$(curl -fsS --max-time 5 http://127.0.0.1:5000/api/java/status)"
  if is_true "$bedrock_status" "server_running"; then
    was_bedrock_running=true
  fi
  if is_true "$java_status" "running"; then
    was_java_running=true
  fi
fi

if [[ -n "$previous_image_id" ]]; then
  docker tag "$previous_image_id" "$rollback_image"
fi
docker load -i "$archive"

if [[ "$was_bedrock_running" == "true" ]]; then
  curl -fsS --max-time 10 -X POST http://127.0.0.1:5000/api/stop >/dev/null
fi
if [[ "$was_java_running" == "true" ]]; then
  curl -fsS --max-time 10 -X POST http://127.0.0.1:5000/api/java/stop >/dev/null
fi
if [[ "$was_bedrock_running" == "true" ]] && ! wait_for_stopped "/api/status" "server_running"; then
  echo "Bedrock did not stop cleanly; leaving the current manager container in place." >&2
  exit 1
fi
if [[ "$was_java_running" == "true" ]] && ! wait_for_stopped "/api/java/status" "running"; then
  echo "Paper did not stop cleanly; leaving the current manager container in place." >&2
  exit 1
fi

restore_running_servers() {
  if [[ "$was_bedrock_running" == "true" ]]; then
    if ! curl -fsS --max-time 10 -X POST http://127.0.0.1:5000/api/start >/dev/null; then
      echo "Could not restart the previously running Bedrock server." >&2
      return 1
    fi
  fi
  if [[ "$was_java_running" == "true" ]]; then
    if ! curl -fsS --max-time 10 -X POST http://127.0.0.1:5000/api/java/start >/dev/null; then
      echo "Could not restart the previously running Paper server." >&2
      return 1
    fi
  fi
}

rollback_deployment() {
  if [[ -z "$previous_image_id" ]]; then
    echo "No previous manager image is available for automatic rollback." >&2
    return 1
  fi

  if ! docker tag "$previous_image_id" "$image"; then
    echo "Could not retag the previous manager image." >&2
    return 1
  fi
  if ! docker compose -f "$deploy_dir/docker-compose.yml" up -d --no-build --force-recreate; then
    echo "Could not recreate the previous manager container." >&2
    return 1
  fi

  for _ in {1..30}; do
    if curl -fsS --max-time 5 http://127.0.0.1:5000/api/status >/dev/null; then
      if ! restore_running_servers; then
        echo "Previous manager was restored, but the previous server state was not fully restored." >&2
        return 1
      fi
      echo "Previous manager image restored." >&2
      return 0
    fi
    sleep 2
  done

  echo "Previous manager image was restored, but its API did not become healthy." >&2
  return 1
}

if ! docker compose -f "$deploy_dir/docker-compose.yml" up -d --no-build --force-recreate; then
  echo "New manager container failed to start; attempting rollback." >&2
  rollback_deployment || true
  exit 1
fi

healthy=false
for _ in {1..30}; do
  if curl -fsS --max-time 5 http://127.0.0.1:5000/api/status >/dev/null; then
    healthy=true
    break
  fi
  sleep 2
done
if [[ "$healthy" != "true" ]]; then
  echo "The manager did not become healthy after deployment; attempting rollback." >&2
  rollback_deployment || true
  exit 1
fi

if ! restore_running_servers; then
  echo "Manager is healthy, but previous server state was not fully restored; attempting rollback." >&2
  rollback_deployment || true
  exit 1
fi

rm -f "$archive"
echo "Manager deployment is healthy."
