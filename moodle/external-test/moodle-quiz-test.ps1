param(
    [Parameter(Mandatory = $true)]
    [string] $MoodleUrl,

    [Parameter(Mandatory = $true)]
    [string] $Token,

    [Parameter(Mandatory = $false)]
    [int] $CourseId = 0
)

$ErrorActionPreference = 'Stop'
$endpoint = "$($MoodleUrl.TrimEnd('/'))/webservice/rest/server.php"

function Invoke-Moodle {
    param(
        [Parameter(Mandatory = $true)]
        [string] $FunctionName,

        [Parameter(Mandatory = $false)]
        [hashtable] $Parameters = @{}
    )

    $form = @{
        wstoken = $Token
        wsfunction = $FunctionName
        moodlewsrestformat = 'json'
    }

    foreach ($key in $Parameters.Keys) {
        $form[$key] = $Parameters[$key]
    }

    $response = Invoke-RestMethod -Uri $endpoint -Method Post -Body $form -ContentType 'application/x-www-form-urlencoded'

    if ($response.exception) {
        throw "Moodle devolvio [$($response.errorcode)]: $($response.message)"
    }

    return $response
}

Write-Host "Conectando con $endpoint ..." -ForegroundColor Cyan
$site = Invoke-Moodle -FunctionName 'core_webservice_get_site_info'
Write-Host "OK: $($site.sitename) (usuario: $($site.username), id: $($site.userid))" -ForegroundColor Green

if ($CourseId -eq 0) {
    Write-Host 'Prueba completada. Indica -CourseId para listar sus cuestionarios.' -ForegroundColor Yellow
    exit 0
}

$quizzes = Invoke-Moodle `
    -FunctionName 'mod_quiz_get_quizzes_by_courses' `
    -Parameters @{ 'courseids[0]' = $CourseId }

if (-not $quizzes.quizzes -or $quizzes.quizzes.Count -eq 0) {
    Write-Host "No se encontraron cuestionarios visibles en el curso $CourseId." -ForegroundColor Yellow
    exit 0
}

Write-Host "Cuestionarios visibles en el curso ${CourseId}:" -ForegroundColor Green
foreach ($quiz in $quizzes.quizzes) {
    Write-Host ("- id={0} nombre={1} intentos={2}" -f $quiz.id, $quiz.name, $quiz.attempts)
}