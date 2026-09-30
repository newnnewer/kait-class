@echo off
chcp 65001 >nul
setlocal
rem ============================================================
rem  KAIT-PLAY - 연습 서버에 KAIT-PLAY 만 올려 설치·업데이트하기
rem  (KAIT-CLASS 는 이미 설치되어 있어야 해요)
rem  이 파일을 두 번 누르면 됩니다.
rem ============================================================
rem 서버 주소는 같은 폴더의 server.local.bat 에 적어 둡니다 (GitHub 에 올라가지 않음). 예)
rem     set SERVER=root@서버IP
rem     set SSH_PORT=22
set SERVER=
set SSH_PORT=22
if exist "%~dp0server.local.bat" call "%~dp0server.local.bat"
if "%SERVER%"=="" set /p SERVER=서버 주소를 넣으세요 (예: root@1.2.3.4): 
set SRC_DIR=/root/kait-play-src

rem 이 파일은 play\deploy 안에 있어요 → play 폴더에서 묶는다
cd /d "%~dp0.."
if not exist "package.json" (
  echo play 폴더를 찾지 못했어요. 이 파일은 play\deploy 안에 있어야 해요.
  pause
  exit /b 1
)

echo.
echo [1/3] 파일 묶는 중...
tar -czf "%TEMP%\kait-play.tgz" --exclude=node_modules --exclude=data --exclude=.env .
if errorlevel 1 (
  echo 묶기에 실패했어요.
  pause
  exit /b 1
)

echo.
echo [2/3] 서버로 보내는 중... 비밀번호를 물으면 서버 root 비밀번호를 넣으세요.
scp -P %SSH_PORT% "%TEMP%\kait-play.tgz" %SERVER%:/root/kait-play.tgz
if errorlevel 1 (
  echo 보내기에 실패했어요. 서버 주소와 SSH 포트를 확인하세요.
  pause
  exit /b 1
)

echo.
echo [3/3] 서버에서 설치하는 중... 비밀번호를 한 번 더 물을 수 있어요.
ssh -t -p %SSH_PORT% %SERVER% "rm -rf %SRC_DIR% && mkdir -p %SRC_DIR% && tar -xzf /root/kait-play.tgz -C %SRC_DIR% && rm -f /root/kait-play.tgz && bash %SRC_DIR%/install.sh"

echo.
pause
