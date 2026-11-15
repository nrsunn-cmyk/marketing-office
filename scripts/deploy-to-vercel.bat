@echo off
chcp 65001 > nul
setlocal

echo =======================================================
echo    AI 마케팅 업무실 - Vercel 프로덕션 원클릭 배포 도구
echo =======================================================
echo.

cd /d "%~dp0\.."

echo [1/3] Vercel 로그인 상태 확인 중...
call npx.cmd vercel whoami > nul 2>&1
if %errorlevel% neq 0 (
    echo [안내] Vercel에 로그인이 필요합니다.
    echo 브라우저 창이 열리면 로그인을 완료해 주세요...
    echo.
    call npx.cmd vercel login
    if %errorlevel% neq 0 (
        echo [오류] Vercel 로그인에 실패했습니다. 배포를 중단합니다.
        pause
        exit /b 1
    )
)

echo [2/3] Vercel 로그인 확인 완료!
echo.
echo -------------------------------------------------------
echo [주의] Vercel 배포 시 필요한 운영 환경 변수:
echo   - NEXT_PUBLIC_SITE_URL: 배포 완료 주소
echo   - NEXT_PUBLIC_SUPABASE_URL: https://vcytfuugmnttaudjpjjh.supabase.co
echo   - NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: Supabase API anon key
echo   - ALLOWED_USER_EMAILS: 본인 이메일
echo -------------------------------------------------------
echo.
echo [3/3] Vercel 프로덕션 배포를 시작합니다...
echo.

call npx.cmd vercel --prod

if %errorlevel% equ 0 (
    echo.
    echo =======================================================
    echo   배포가 성공적으로 완료되었습니다!
    echo.
    echo   [다음 필수 단계]
    echo   1. Vercel 대시보드에서 위 환경 변수 4종을 입력하세요.
    echo   2. 생성된 배포 URL을 Supabase URL Configuration에 등록하세요.
    echo =======================================================
) else (
    echo.
    echo [오류] 배포 중 오류가 발생했습니다. 로그를 확인해 주세요.
)

echo.
pause
