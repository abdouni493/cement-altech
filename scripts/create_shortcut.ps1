$ws = New-Object -ComObject WScript.Shell
$desktopShortcut = $ws.CreateShortcut('C:\Users\Admin\Desktop\Cement Store.lnk')
$desktopShortcut.TargetPath = 'C:\Users\Admin\Desktop\cement - demo\lancer-cement-store.bat'
$desktopShortcut.WorkingDirectory = 'C:\Users\Admin\Desktop\cement - demo'
$desktopShortcut.Description = 'Cement Store - Application Vente et Fabrication de Ciment'
$desktopShortcut.Save()

$localShortcut = $ws.CreateShortcut('C:\Users\Admin\Desktop\cement - demo\Cement Store.lnk')
$localShortcut.TargetPath = 'C:\Users\Admin\Desktop\cement - demo\lancer-cement-store.bat'
$localShortcut.WorkingDirectory = 'C:\Users\Admin\Desktop\cement - demo'
$localShortcut.Description = 'Cement Store - Application Vente et Fabrication de Ciment'
$localShortcut.Save()

Write-Host "Shortcuts created successfully."
