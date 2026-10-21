$ErrorActionPreference = "Stop"
Write-Error "This legacy deployment script targets the retired systemd host. Deploy through the GitHub Actions workflow after configuring its SSH secrets for the GCP pro VM."
exit 1
