param(
    [string]$RepoDir = "C:\\Users\\ubuntu\\vib-app",
    [string]$Domain = "yourdomain.com"
)

Write-Host "Repo dir: $RepoDir"
Set-Location $RepoDir

Write-Host "Building images..."
docker compose -f docker-compose.prod.yml build --pull

Write-Host "Starting containers..."
docker compose -f docker-compose.prod.yml up -d

Write-Host "Reloading nginx (if applicable)"
try { Start-Process -FilePath systemctl -ArgumentList 'reload nginx' -NoNewWindow -Wait } catch { }

Write-Host "Done. Visit http://$Domain or http://<server-ip>:3000"
