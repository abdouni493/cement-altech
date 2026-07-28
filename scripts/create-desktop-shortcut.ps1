$desktop = [Environment]::GetFolderPath('Desktop')
$wsh = New-Object -ComObject WScript.Shell
$lnkPath = [System.IO.Path]::Combine($desktop,'Produits Chimiques.lnk')
$lnk = $wsh.CreateShortcut($lnkPath)
$lnk.TargetPath = 'C:\Users\Admin\Desktop\produits chemique\run-app.bat'
$lnk.WorkingDirectory = 'C:\Users\Admin\Desktop\produits chemique'
$lnk.IconLocation = 'C:\Users\Admin\Desktop\produits chemique\produit-chimique.ico'
$lnk.WindowStyle = 1
$lnk.Description = 'Start Produits Chimiques'
$lnk.Save()
Write-Host "Created shortcut: $lnkPath"
