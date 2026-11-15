@echo off
chcp 65001 > nul
setlocal

echo =======================================================
echo    AI 마케팅 업무실 - 운영 소유자(Owner) 계정 생성 도구
echo =======================================================
echo.

cd /d "%~dp0\.."

if not exist ".env.production.local" (
    echo [오류] .env.production.local 파일이 없습니다.
    echo 먼저 .env.production.local.example 파일을 복사하여
    echo .env.production.local 을 만들고 필요한 키를 입력해 주세요.
    echo.
    pause
    exit /b 1
)

set USER_EMAIL=%~1
if "%USER_EMAIL%"=="" (
    set /p USER_EMAIL="생성할 소유자 이메일 주소를 입력하세요: "
)

if "%USER_EMAIL%"=="" (
    echo [오류] 이메일 주소가 입력되지 않았습니다.
    pause
    exit /b 1
)

echo.
echo [%USER_EMAIL%] 계정 생성을 시작합니다...
echo.

node --env-file=.env.production.local scripts/create-owner.mts %USER_EMAIL%

if %errorlevel% equ 0 (
    echo.
    echo [완료] 소유자 계정이 성공적으로 등록되었습니다!
) else (
    echo.
    echo [오류] 계정 등록 중 문제가 발생했습니다. 키 값과 이메일을 확인하세요.
)

echo.
pause
