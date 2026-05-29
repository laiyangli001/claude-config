# Proxy — 自动从 Windows 系统代理设置读取
# 被 .bashrc source 调用，VPN 开时自动设代理，关时自动跳过
if command -v powershell &>/dev/null; then
  proxy_info=$(powershell -NoProfile -Command "
    \$reg = Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings'
    if (\$reg.ProxyEnable -eq 1 -and \$reg.ProxyServer) { Write-Output \$reg.ProxyServer }
  " 2>/dev/null)
  # NO_PROXY: 国内域名和局域网不走代理
  export NO_PROXY="localhost,127.0.0.1,.cn,.local,.mineru.net,.baidu.com,.qq.com,.aliyun.com,.taobao.com,.jd.com,.weixin.qq.com"
  if [ -n "$proxy_info" ]; then
    export HTTP_PROXY="http://$proxy_info"
    export HTTPS_PROXY="http://$proxy_info"
  fi
fi
