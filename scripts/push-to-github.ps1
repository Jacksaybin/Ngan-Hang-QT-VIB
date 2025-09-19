Param(
  [string]$Remote = 'origin',
  [string]$Branch = 'main',
  [string]$Message = 'Update from local'
)

Write-Host "Staging all changes..."
git add .

Write-Host "Committing with message: $Message"
git commit -m $Message

Write-Host "Pushing to $Remote/$Branch..."
git push $Remote $Branch

Write-Host "Done. If authentication fails, run these commands manually and provide credentials or set up SSH keys."
