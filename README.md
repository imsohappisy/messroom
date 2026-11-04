# messroom - P2P 메신저 (Windows & Mac)

서로 다른 IP 환경에서도 중계 서버 없이 직접 연결되는 크로스 플랫폼 완전 P2P 메신저 **messroom**입니다.

---

## 주요 특징 및 요구사항 반영

- **완전 P2P 직접 통신**: 메시지, 파일 전송 등 모든 데이터는 중앙 서버를 거치지 않고 피어 간에 직접 암호화(DTLS-SRTP)되어 전송됩니다.
- **상호 IP 및 네트워크 정보 투명 공개**: 서로 노출을 감안하고 사용하는 환경에 맞춰 상대방의 공인 IP, 로컬 IP, 접속 포트, STUN 홀펀칭 유형, 실시간 핑(RTT ms)을 헤더와 진단 HUD에 실시간 표시합니다.
- **각진 사각형 및 단색 디자인**: 둥글기(border-radius)를 배제한 순수 각진 직사각형 버튼과 카드, 그라데이션이 전혀 없는 플랫 솔리드(Solid) 단색 인터페이스.
- **이모티콘 제로 & 구글 머티리얼 심볼 아이콘**: 모든 이모티콘을 배제하고 구글 정식 머티리얼 심볼(Google Material Symbols) 아이콘을 적용.
- **계정 및 프로필 기능**: 닉네임, 상태 메시지, 기본 아바타 선택 및 사용자 로컬 사진 업로드, 단색 테마(블루, 그린, 앰버, 징크) 선택, 연결 시 상대방에게 실시간 프로필 동기화.
- **무제한 대용량 파일 전송**: WebRTC RTCDataChannel을 통해 청크 단위(64KB)로 직접 스트리밍하며 드래그 앤 드롭 전송 및 전송 진행률/속도 표시 지원.
- **윈도우 및 맥 독립 빌드 완료**: 맥용(.dmg, .app, .zip) 및 윈도우용(.exe, .zip) 배포본 완비.

---

## P2P 연결 방식 (3가지 모드 지원)

### 1. 룸 코드 접속 (STUN 기반 완전 P2P) - 추천
- **원리**: 구글 공용 STUN 서버(`stun:stun.l.google.com:19302`)를 활용하여 서로 다른 공유기(NAT) 아래에 있는 두 컴퓨터 간에 NAT 홀펀칭을 수행합니다.
- **사용법**:
  1. 한 사용자가 '방 만들기'를 누르고 생성된 룸 코드(예: `MESS-7721`)를 친구에게 알려줍니다.
  2. 친구가 '방 참가하기'에서 동일한 룸 코드를 입력합니다.
  3. 약 1초 만에 직접 연결(RTCDataChannel)이 수립되며, 수립 즉시 임시 시그널링 통로는 완전히 닫히고 100% P2P 통신으로 전환됩니다.

### 2. 직접 IP:Port 모드 (소켓 직접 통신)
- **원리**: 내장 웹소켓/TCP 소켓을 통해 중계나 외부 개입 없이 IP와 포트로 직접 통신합니다.
- **사용법**:
  1. 호스트 측에서 원하는 포트(기본: 48800)를 입력하고 '서버 시작'을 누릅니다.
  2. 접속자 측에서 호스트의 공인 IP(또는 가상 사설망 IP)와 포트를 입력하고 '직접 연결'을 누릅니다.

### 3. 수동 티켓 교환 (완전 오프라인 / 에어갭 P2P)
- **원리**: 네트워크 방화벽이 엄격한 환경에서도 Offer/Answer 텍스트 페이로드(Base64)를 복사/붙여넣기하여 서버 통신 0%로 P2P를 연결합니다.

---

## 다운로드 및 실행 파일 (GitHub Releases)

[GitHub Releases 바로가기 (v1.0.0)](https://github.com/imsohappisy/messroom/releases/tag/v1.0.0)

### 🪟 Windows 버전
- **단독 포터블 실행 파일**: [Messroom.exe 다운로드](https://github.com/imsohappisy/messroom/releases/download/v1.0.0/Messroom.exe) (설치 없이 더블클릭 실행)
- **전체 압축본**: [Messroom-1.0.0-win.zip 다운로드](https://github.com/imsohappisy/messroom/releases/download/v1.0.0/Messroom-1.0.0-win.zip)

### 🍎 Mac 버전
- **설치용 DMG**: [Messroom-1.0.0.dmg 다운로드](https://github.com/imsohappisy/messroom/releases/download/v1.0.0/Messroom-1.0.0.dmg)
- **ZIP 압축본**: [Messroom-1.0.0-mac.zip 다운로드](https://github.com/imsohappisy/messroom/releases/download/v1.0.0/Messroom-1.0.0-mac.zip)

---

## 개발자 모드 실행 방법

```bash
# 종속성 설치 (최초 1회)
npm install

# 앱 개발 모드 실행
npm start

# 맥 버전 패키징
npm run dist:mac

# 윈도우 버전 패키징
npm run dist:win
```
