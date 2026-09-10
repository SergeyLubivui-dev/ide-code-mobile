# IDE Code: приглашение и цвета песочницы PowerShell.
#
# Движок запускает файл через «-NoExit -File», поэтому всё, что должно пережить
# запуск скрипта, объявлено в global-области: обычная функция осталась бы в
# области скрипта и исчезла бы вместе с ним.

# Проект смонтирован в /workspace, и стандартное приглашение печатает этот путь
# целиком: «PS /workspace/src>». На телефоне это половина строки ещё до курсора.
# Показываем путь от корня проекта: «~», «~/src». Ушли наружу — обычный
# абсолютный путь, чтобы приглашение не врало.
function global:prompt {
    $ws = '/workspace'
    $path = $ExecutionContext.SessionState.Path.CurrentLocation.Path
    if ($path -eq $ws) { $short = '~' }
    elseif ($path.StartsWith($ws + '/')) { $short = '~/' + $path.Substring($ws.Length + 1) }
    else { $short = $path }
    # Заголовок окна читает интерфейс: по нему видно, где мы, когда приглашение
    # рисует уже не эта оболочка, а удалённая машина после ssh.
    try { $Host.UI.RawUI.WindowTitle = $short } catch {}
    "$short> "
}

# Подсветка ввода приходит из PSReadLine, а её цвета по умолчанию рассчитаны на
# светлый фон. Ставим ту же палитру, что у самого терминала в интерфейсе.
try {
    Import-Module PSReadLine -ErrorAction Stop
    Set-PSReadLineOption -Colors @{
        Command          = '#61afef'
        Parameter        = '#c678dd'
        Operator         = '#56b6c2'
        Variable         = '#e5c07b'
        String           = '#98c379'
        Number           = '#d19a66'
        Type             = '#e5c07b'
        Member           = '#e6e7eb'
        Comment          = '#5c6370'
        Keyword          = '#c678dd'
        Error            = '#e06c75'
        InlinePrediction = '#5c6370'
    }
    # На телефоне каждое нажатие дорого: подсказка из истории экономит строку.
    Set-PSReadLineOption -PredictionSource History -HistoryNoDuplicates
} catch {}

# Известные хосты ssh пишутся в домашнюю папку, а она на tmpfs и создаётся
# заново при каждом запуске контейнера.
if ($env:HOME) {
    $sshHome = Join-Path $env:HOME '.ssh'
    if (-not (Test-Path $sshHome)) { New-Item -ItemType Directory -Path $sshHome -Force | Out-Null }
}
