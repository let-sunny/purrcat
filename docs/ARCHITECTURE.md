# purrcat 아키텍처 문서

## 목차

1. [개요](#개요)
2. [핵심 설계 원칙](#핵심-설계-원칙)
3. [모듈 구조](#모듈-구조)
4. [클래스 기반 구조](#클래스-기반-구조)
5. [상태 관리](#상태-관리)
6. [이벤트 시스템](#이벤트-시스템)
7. [제너레이터 기반 스트림](#제너레이터-기반-스트림)
8. [재연결 메커니즘](#재연결-메커니즘)
9. [버퍼 관리](#버퍼-관리)
10. [데이터 흐름](#데이터-흐름)
11. [설계 결정 사항](#설계-결정-사항)

---

## 개요

purrcat은 경량화된 WebSocket 클라이언트 라이브러리로, 자동 재연결, 백오프 전략, 메시지 버퍼링, 그리고 async iterable을 통한 스트림 처리를 제공합니다.

### 주요 특징

- **경량화**: 6KB 미만 (gzip 압축 시 ~2KB)
- **자동 재연결**: 지수/선형 백오프 + 지터
- **버퍼 관리**: 크기 제한 및 오버플로우 정책
- **Async Iterable**: 제너레이터 기반 메시지 스트림
- **타입 안정성**: 완전한 TypeScript 지원
- **Zero Dependencies**: 네이티브 WebSocket API만 사용

---

## 핵심 설계 원칙

### 1. 클래스 기반 구조

가독성과 유지보수성을 향상시키기 위해 클래스 기반 구조를 채택했습니다.

**왜 클래스를 선택했는가?**

- **명확한 책임 분리**: 각 클래스가 단일 책임을 가짐
  - `EventHandler`: 이벤트 발생 및 큐 관리
  - `MessageHandler`: 메시지 수신/송신 및 버퍼링
  - `ConnectionHandler`: WebSocket 연결/재연결 관리
  - `SocketImpl`: 위 핸들러들을 조합하여 Socket 인터페이스 구현
- **가독성 향상**: Public 메서드를 상단, Private 메서드를 하단에 배치
- **유지보수성**: 각 클래스를 독립적으로 수정 및 테스트 가능
- **타입 안정성**: 제네릭 타입을 명확하게 전달

### 2. 이벤트 중심 아키텍처

모든 상태 변화를 이벤트로 추적하여 투명성과 디버깅 용이성을 확보합니다.

### 3. 제너레이터 기반 스트림

Async iterable을 활용하여 메시지와 이벤트를 스트림으로 처리합니다.

---

## 모듈 구조

```
src/
├── index.ts          # 공개 API 진입점
├── socket.ts         # Socket 클래스 + createSocket 팩토리
├── handlers/         # 핸들러 클래스들
│   ├── event-handler.ts      # EventHandler 클래스
│   ├── message-handler.ts    # MessageHandler 클래스
│   └── connection-handler.ts # ConnectionHandler 클래스
├── generators.ts     # Async iterable 제너레이터
├── types.ts          # TypeScript 타입 정의
├── utils.ts          # 유틸리티 함수
└── constants.ts      # 상수 정의
```

### 모듈별 역할

#### `socket.ts`
- `createSocket()`: 팩토리 함수로 소켓 인스턴스 생성
- `Socket`: 위 핸들러들을 조합하여 Socket 인터페이스 구현

#### `handlers/event-handler.ts`
- `EventHandler`: 이벤트 발생 및 큐 관리

#### `handlers/message-handler.ts`
- `MessageHandler`: 메시지 수신/송신 및 버퍼링

#### `handlers/connection-handler.ts`
- `ConnectionHandler`: WebSocket 연결/재연결 관리

#### `generators.ts`
- `messagesGenerator()`: 메시지 스트림 제너레이터
- `eventsGenerator()`: 이벤트 스트림 제너레이터

#### `types.ts`
- 모든 TypeScript 타입 정의
- 공개 API 인터페이스
- 내부 상태 타입

#### `utils.ts`
- `createEvent()`: 이벤트 객체 생성
- `calculateReconnectInterval()`: 재연결 간격 계산
- `normalizeOptions()`: 옵션 정규화
- `createState()`: 상태 객체 생성
- `parseMessage()`: 메시지 파싱
- `serializeMessage()`: 메시지 직렬화
- `handleBufferOverflow()`: 버퍼 오버플로우 처리
- `createDroppedEvent()`: 드롭된 이벤트 생성

#### `constants.ts`
- 하드코딩된 숫자 값들을 상수로 정의
- `DEFAULT_RECONNECT_INTERVAL`, `MAX_RECENT_EVENTS` 등

---

## 클래스 기반 구조

### 클래스 계층 구조

```
createSocket()
    ↓
Socket<Incoming, Outgoing>
    ├── EventHandler<Incoming>
    ├── MessageHandler<Incoming, Outgoing>
    └── ConnectionHandler<Incoming, Outgoing>
```

### EventHandler 클래스

이벤트 발생 및 큐 관리를 담당합니다.

```typescript
class EventHandler<Incoming> {
  constructor(private state: InternalSocketState<Incoming>) {}
  
  emit(event: SocketEvent): void {
    // 콜백 호출
    // 이벤트 큐 관리
    // 이터레이터 알림
  }
}
```

**주요 책임:**
- 이벤트 콜백 호출
- 이벤트 큐 관리 (메모리 누수 방지)
- 이터레이터 알림 (resolver 깨우기)

### MessageHandler 클래스

메시지 수신/송신 및 버퍼링을 담당합니다.

```typescript
class MessageHandler<Incoming, Outgoing> {
  constructor(
    private state: InternalSocketState<Incoming>,
    private opts: NormalizedSocketOptions,
    private eventHandler: EventHandler<Incoming>
  ) {}
  
  // Public 메서드
  receive(data: string): void
  receiveMessages(messages: AsyncIterable<string>, options?): Promise<void>
  send(data: Outgoing): void
  sendMessages(messages: AsyncIterable<Outgoing>, options?): Promise<void>
  flushQueue(): void
  
  // Private 메서드
  private handleCallbacks(parsed: Incoming): void
  private bufferReceivedMessage(data: string): void
  private handleSendImmediately(message, data): void
  private queueSendMessage(messageStr: string): void
}
```

**주요 책임:**
- 메시지 수신 처리 (파싱, 콜백, 버퍼링)
- 메시지 송신 처리 (직렬화, 즉시 전송 또는 큐잉)
- 버퍼 오버플로우 처리
- 큐 플러시

**메서드 분리:**
- `receive`: `handleCallbacks` + `bufferReceivedMessage`로 분리
- `send`: `handleSendImmediately` + `queueSendMessage`로 분리
- 일관된 네이밍 패턴: `handle*` (처리 로직), `buffer*/queue*` (버퍼/큐 관련)

### ConnectionHandler 클래스

WebSocket 연결/재연결 및 생명주기 관리를 담당합니다.

```typescript
class ConnectionHandler<Incoming, Outgoing> {
  constructor(
    private state: InternalSocketState<Incoming>,
    private opts: NormalizedSocketOptions,
    private eventHandler: EventHandler<Incoming>,
    private messageHandler: MessageHandler<Incoming, Outgoing>
  ) {}
  
  scheduleReconnect(): void
  connect(): void
  close(code?: number, reason?: string): void
}
```

**주요 책임:**
- WebSocket 연결 생성 및 관리
- 재연결 스케줄링
- 연결 종료 처리
- 이벤트 핸들러 설정 (onopen, onmessage, onerror, onclose)

### Socket 클래스

위 핸들러들을 조합하여 Socket 인터페이스를 구현합니다.

```typescript
class Socket<Incoming, Outgoing> implements SocketInterface<Incoming, Outgoing> {
  private eventHandler: EventHandler<Incoming>;
  private messageHandler: MessageHandler<Incoming, Outgoing>;
  private connectionHandler: ConnectionHandler<Incoming, Outgoing>;
  
  // Public API
  messages(options?): AsyncIterable<Incoming>
  events(options?): AsyncIterable<SocketEvent>
  onMessage(callback): () => void
  onEvent(callback): () => void
  connect(): void
  close(code?, reason?): void
  send(data: Outgoing): void
  sendMessages(messages, options?): Promise<void>
}
```

**주요 책임:**
- 핸들러 인스턴스 생성 및 조합
- Socket 인터페이스 구현
- Public API 제공

**파일 구조:**
- `socket.ts`: Socket 클래스와 createSocket 팩토리 함수
- 각 핸들러는 `handlers/` 디렉토리의 별도 파일로 분리

### 코드 구조 개선

**Public 메서드 우선 배치:**
- 클래스 상단에 Public 메서드를 배치하여 인터페이스를 빠르게 파악 가능
- `receive`, `send`, `receiveMessages`, `sendMessages`, `flushQueue` 등

**Private 메서드 하단 배치:**
- 구현 세부사항은 클래스 하단에 배치
- `handleCallbacks`, `bufferReceivedMessage`, `handleSendImmediately`, `queueSendMessage` 등

---

## 상태 관리

### InternalSocketState

소켓의 모든 내부 상태를 관리하는 객체입니다.

```typescript
interface InternalSocketState<Incoming> {
  ws: WebSocket | null;                    // WebSocket 인스턴스
  isManualClose: boolean;                   // 수동 종료 여부
  reconnectCount: number;                   // 재연결 시도 횟수
  reconnectTimer: ReturnType<typeof setTimeout> | null;  // 재연결 타이머
  messageBuffer: string[];                  // 수신 메시지 버퍼
  eventQueue: SocketEvent[];                // 이벤트 큐
  messageQueue: string[];                   // 송신 메시지 큐
  messageCallbacks: Set<(data: Incoming) => void>;  // 메시지 콜백
  eventCallbacks: Set<(event: SocketEvent) => void>;  // 이벤트 콜백
  abortController: AbortController | null;  // 중단 컨트롤러
  activeMessageIterators: number;          // 활성 메시지 이터레이터 수
  activeEventIterators: number;             // 활성 이벤트 이터레이터 수
  messageResolvers: Set<() => void>;        // 메시지 대기 해결자
  eventResolvers: Set<() => void>;          // 이벤트 대기 해결자
}
```

### 상태 접근 패턴

모든 핸들러 클래스는 생성자를 통해 `state`와 `opts`를 받아 사용합니다:

```typescript
class MessageHandler<Incoming, Outgoing> {
  constructor(
    private state: InternalSocketState<Incoming>,
    private opts: NormalizedSocketOptions,
    private eventHandler: EventHandler<Incoming>
  ) {}
  
  receive(data: string): void {
    // state와 opts에 직접 접근
    const parsed = parseMessage<Incoming>(data);
    this.handleCallbacks(parsed);
    this.bufferReceivedMessage(data);
  }
}
```

---

## 이벤트 시스템

### 이벤트 타입

```typescript
type SocketEventType =
  | 'open'        // 연결 열림
  | 'close'       // 연결 닫힘
  | 'error'       // 에러 발생
  | 'reconnect'    // 재연결 시도
  | 'received'    // 메시지 수신
  | 'sent'        // 메시지 전송
  | 'dropped';    // 메시지 드롭
```

### 이벤트 발생 흐름

```
이벤트 발생
    ↓
EventHandler.emit()
    ↓
    ├─→ eventCallbacks (즉시 호출)
    ├─→ eventQueue (큐에 추가)
    └─→ eventResolvers (대기 중인 이터레이터 깨우기)
```

### 이벤트 처리 방식

1. **콜백 방식**: `onEvent()`로 등록한 콜백 즉시 호출
2. **스트림 방식**: `events()` 제너레이터로 이벤트 스트림 소비
3. **하이브리드**: 두 방식을 동시에 사용 가능

---

## 콜백 vs 제너레이터: API 선택 가이드

purrcat은 두 가지 API 스타일을 모두 지원합니다. 각각의 장단점과 사용 시나리오를 이해하면 프로젝트에 맞는 선택을 할 수 있습니다.

### 콜백 기반 API

```typescript
const socket = createSocket({ url: 'wss://example.com' });

socket.onMessage((message) => {
  console.log('Received:', message);
});

socket.onEvent((event) => {
  console.log('Event:', event.type);
});
```

#### 장점

1. **즉시 실행**: 메시지 도착 시 즉시 콜백 호출, 지연 없음
2. **메모리 효율**: 버퍼링 없이 직접 처리 (이터레이터가 없을 때)
3. **간단한 사용**: 설정이 단순하고 직관적
4. **이벤트 기반**: 전통적인 이벤트 리스너 패턴과 유사
5. **다중 핸들러**: 여러 콜백을 동시에 등록 가능

#### 단점

1. **제어 흐름 제한**: 순차 처리나 조건부 처리가 어려움
2. **에러 처리 복잡**: 각 콜백에서 개별적으로 에러 처리 필요
3. **비동기 처리 어려움**: 콜백 내부에서 async/await 사용 시 주의 필요
4. **중단 제어 어려움**: 특정 조건에서 메시지 수신 중단이 복잡

#### 추천 사용 시나리오

- **실시간 알림**: 메시지 도착 즉시 처리해야 하는 경우
- **간단한 로깅/모니터링**: 모든 메시지를 단순히 기록하거나 전달하는 경우
- **이벤트 기반 아키텍처**: 기존 이벤트 리스너 패턴과 일관성 유지
- **다중 구독자**: 여러 핸들러가 동시에 메시지를 처리해야 하는 경우

### 제너레이터 기반 API

```typescript
const socket = createSocket({ url: 'wss://example.com' });

// 메시지 스트림
for await (const message of socket.messages()) {
  console.log('Received:', message);
  // 조건부 처리, 중단 등이 쉬움
  if (shouldStop(message)) break;
}

// 이벤트 스트림
for await (const event of socket.events({ signal: abortController.signal })) {
  console.log('Event:', event.type);
  // AbortSignal로 중단 가능
}
```

#### 장점

1. **순차 처리**: 메시지를 순서대로 하나씩 처리 가능
2. **제어 흐름**: 조건문, 반복문, 중단 등 일반적인 제어 흐름 사용 가능
3. **에러 처리**: try-catch로 통합 에러 처리 가능
4. **중단 제어**: `break`, `return`, `AbortSignal`로 쉽게 중단 가능
5. **비동기 처리**: async/await와 자연스럽게 통합
6. **스트림 처리**: 백프레셔(backpressure) 처리에 유리
7. **타입 안정성**: TypeScript와 잘 통합

#### 단점

1. **메모리 사용**: 이터레이터가 활성화되면 버퍼링 필요
2. **초기 지연**: 이터레이터 시작 전 메시지는 버퍼에 저장
3. **단일 소비자**: 하나의 이터레이터가 메시지를 소비 (여러 이터레이터는 각각 독립적으로 동작)
4. **학습 곡선**: async iterable에 대한 이해 필요

#### 추천 사용 시나리오

- **순차 처리**: 메시지를 순서대로 처리해야 하는 경우
- **조건부 처리**: 특정 조건에 따라 메시지 처리 로직을 변경해야 하는 경우
- **에러 복구**: 에러 발생 시 재시도나 복구 로직이 필요한 경우
- **스트림 변환**: 메시지를 변환하거나 필터링하는 파이프라인 구축
- **중단 가능한 작업**: 사용자 액션이나 특정 조건에서 수신을 중단해야 하는 경우
- **복잡한 비즈니스 로직**: 여러 단계의 비동기 처리가 필요한 경우

### 하이브리드 사용

두 API를 동시에 사용할 수 있습니다:

```typescript
const socket = createSocket({ url: 'wss://example.com' });

// 콜백: 모든 메시지 로깅
socket.onMessage((msg) => console.log('Log:', msg));

// 제너레이터: 특정 메시지만 처리
for await (const msg of socket.messages()) {
  if (msg.type === 'important') {
    await processImportantMessage(msg);
  }
}
```

### 성능 고려사항

- **콜백만 사용**: 메모리 사용 최소화, 즉시 처리
- **제너레이터만 사용**: 버퍼링으로 인한 메모리 사용, 순차 처리 가능
- **하이브리드**: 콜백은 즉시 처리, 제너레이터는 버퍼에서 소비

### 선택 가이드

| 상황 | 추천 API |
|------|----------|
| 실시간 알림, 간단한 로깅 | 콜백 |
| 순차 처리, 조건부 로직 | 제너레이터 |
| 에러 복구, 재시도 로직 | 제너레이터 |
| 다중 구독자 패턴 | 콜백 |
| 스트림 변환/필터링 | 제너레이터 |
| 사용자 중단 가능한 작업 | 제너레이터 (AbortSignal) |
| 메모리 제약이 큰 환경 | 콜백 (제너레이터 비활성화) |

---

## 제너레이터 기반 스트림

### 메시지 스트림

```typescript
async function* messagesGenerator(state, signal) {
  state.activeMessageIterators++;
  
  try {
    while (true) {
      // 버퍼된 메시지 yield
      while (state.messageBuffer.length > 0) {
        yield parseMessage(state.messageBuffer.shift());
      }
      
      // 새 메시지 대기
      await waitForItems(...);
    }
  } finally {
    state.activeMessageIterators--;
    // 마지막 이터레이터가 종료되면 버퍼 클리어
    if (state.activeMessageIterators === 0) {
      state.messageBuffer = [];
    }
  }
}
```

### 이벤트 기반 대기 메커니즘

`waitForItems()`는 효율적인 대기 메커니즘을 제공합니다:

1. **즉시 확인**: 이미 아이템이 있으면 즉시 반환
2. **이벤트 기반**: resolver를 등록하여 새 아이템 도착 시 즉시 알림
3. **폴링 폴백**: AbortSignal이 없을 때만 100ms 간격으로 폴링

### 이터레이터 생명주기 관리

- `activeMessageIterators`: 활성 메시지 이터레이터 수 추적
- `activeEventIterators`: 활성 이벤트 이터레이터 수 추적
- 마지막 이터레이터 종료 시 버퍼/큐 자동 클리어 (메모리 누수 방지)

### 이벤트 큐 메모리 관리

이벤트 큐는 메모리 누수를 방지하면서도 이터레이터 시작 전 이벤트를 받을 수 있도록 최적화되었습니다:

- **이터레이터가 활성화된 경우**: 모든 이벤트를 큐에 추가하고 즉시 알림
- **이터레이터가 없는 경우**: 최근 10개의 이벤트만 유지 (메모리 누수 방지)
  - 새 이터레이터가 시작되면 최근 이벤트를 받을 수 있음
  - 콜백만 사용하는 경우에도 무한 증가 방지

---

## 재연결 메커니즘

### 재연결 전략

1. **지수 백오프 (exponential)**: `interval * 2^attempt`
2. **선형 백오프 (linear)**: `interval * (attempt + 1)`
3. **지터 (jitter)**: ±20% 랜덤 변동 (thundering herd 방지)

### 재연결 흐름

```
연결 종료
    ↓
onclose 이벤트
    ↓
수동 종료가 아니고 재연결 활성화?
    ↓
ConnectionHandler.scheduleReconnect()
    ↓
간격 계산 (백오프 + 지터)
    ↓
타이머 설정
    ↓
재연결 시도
    ↓
ConnectionHandler.connect()
```

### 재연결 제한

- `attempts`: 최대 재연결 시도 횟수 (기본값: Infinity)
- `maxInterval`: 최대 재연결 간격 (기본값: 30000ms)

---

## 버퍼 관리

### 수신 버퍼 (messageBuffer)

메시지 수신 시 버퍼링:

- **조건**: `activeMessageIterators > 0`일 때만 버퍼링
- **크기 제한**: `opts.buffer.receive.size` (기본값: 100)
- **오버플로우 정책**:
  - `oldest`: 가장 오래된 메시지 제거
  - `newest`: 새 메시지 버림
  - `error`: 에러 발생

### 송신 큐 (messageQueue)

연결이 닫혀있을 때 메시지 큐잉:

- **크기 제한**: `opts.buffer.send.size` (기본값: 100)
- **오버플로우 정책**: 수신 버퍼와 동일
- **자동 플러시**: 연결 성공 시 자동으로 큐의 메시지 전송

### 버퍼 생명주기

- **메시지 버퍼**: 
  - 이터레이터가 활성화된 경우에만 버퍼링
  - 마지막 메시지 이터레이터 종료 시 클리어
- **이벤트 큐**: 
  - 이터레이터가 활성화된 경우: 모든 이벤트 큐에 추가
  - 이터레이터가 없는 경우: 최근 10개만 유지 (메모리 누수 방지)
  - 마지막 이벤트 이터레이터 종료 시 클리어
- **메시지 큐**: 연결 종료 시 클리어

---

## 데이터 흐름

### 메시지 수신 흐름

```
WebSocket.onmessage
    ↓
ConnectionHandler.connect() → onmessage 핸들러
    ↓
MessageHandler.receive(data)
    ↓
    ├─→ JSON 파싱 시도
    ├─→ EventHandler.emit('received')
    ├─→ handleCallbacks() → messageCallbacks 호출
    └─→ bufferReceivedMessage() → messageBuffer에 추가 (이터레이터가 있을 때만)
            ↓
        messageResolvers 깨우기
            ↓
        messagesGenerator에서 yield
```

### 메시지 송신 흐름

```
send(data)
    ↓
MessageHandler.send()
    ↓
연결 상태 확인
    ├─→ OPEN: handleSendImmediately()
    │       ↓
    │   EventHandler.emit('sent')
    │
    └─→ 닫힘: queueSendMessage()
            ↓
        버퍼 오버플로우 체크
            ↓
        오버플로우 시 정책에 따라 처리
```

### 이벤트 흐름

```
상태 변화 발생
    ↓
EventHandler.emit(event)
    ↓
    ├─→ eventCallbacks 즉시 호출
    ├─→ eventQueue에 추가
    └─→ eventResolvers 깨우기
            ↓
        eventsGenerator에서 yield
```

---

## 설계 결정 사항

### 왜 클래스를 선택했는가?

1. **가독성 향상**: Public 메서드를 상단에 배치하여 인터페이스를 빠르게 파악 가능
2. **명확한 책임 분리**: 각 클래스가 단일 책임을 가짐
3. **유지보수성**: 각 클래스를 독립적으로 수정 및 테스트 가능
4. **타입 안정성**: 제네릭 타입을 명확하게 전달
5. **코드 구조**: Public/Private 메서드 분리로 구조 명확화

### 메서드 분리 전략

**receive 메서드 분리:**
- `handleCallbacks`: 콜백 호출 로직
- `bufferReceivedMessage`: 버퍼링 로직
- `receive`: 위 두 메서드를 조합

**send 메서드 분리:**
- `handleSendImmediately`: 즉시 전송 로직
- `queueSendMessage`: 큐잉 로직
- `send`: 위 두 메서드를 조합

**일관된 네이밍 패턴:**
- `handle*`: 처리 로직 (handleCallbacks, handleSendImmediately)
- `buffer*/queue*`: 버퍼/큐 관련 (bufferReceivedMessage, queueSendMessage)

### 왜 순수 함수로 만들지 않았는가?

1. **상태 변경 필수**: WebSocket 연결, 타이머, 버퍼 조작 등
2. **부수 효과**: 이벤트 발생, 네트워크 통신 등이 핵심 기능
3. **실용성**: 순수 함수로 만들면 코드가 과도하게 복잡해짐

---

## 확장성 고려사항

### 현재 구조의 장점

- **모듈화**: 각 클래스가 명확한 책임을 가짐
- **타입 안정성**: TypeScript로 완전한 타입 체크
- **테스트 용이성**: 각 클래스를 독립적으로 테스트 가능
- **가독성**: Public/Private 메서드 분리로 구조 명확화

### 향후 개선 가능 영역

- **플러그인 시스템**: 재연결 전략, 버퍼 정책 등을 플러그인으로 확장
- **로깅 시스템**: 이벤트 기반 로깅 시스템 통합
- **메트릭 수집**: 연결 상태, 메시지 처리량 등 메트릭 수집

---

## 성능 고려사항

### 메모리 관리

- **메시지 버퍼**: 이터레이터가 활성화된 경우에만 버퍼링 (메모리 누수 방지)
- **이벤트 큐**: 
  - 이터레이터가 활성화된 경우: 모든 이벤트 큐에 추가
  - 이터레이터가 없는 경우: 최근 10개만 유지 (무한 증가 방지)
  - 이터레이터 종료 시: 큐 자동 클리어
- **콜백 관리**: Set을 통한 효율적인 콜백 추가/제거
- **리소스 정리**: 연결 종료 시 타이머, 큐 등 모든 리소스 정리

### 네트워크 효율성

- 연결이 열릴 때까지 메시지 큐잉
- 버퍼 오버플로우 정책으로 메모리 사용량 제어
- 재연결 시 지터를 통한 서버 부하 분산

---

## 결론

purrcat의 아키텍처는 **클래스 기반 구조**, **이벤트 중심 설계**, **제너레이터 기반 스트림**을 핵심으로 합니다. 가독성과 유지보수성을 향상시키기 위해 클래스 기반 구조를 채택했으며, 각 클래스가 명확한 책임을 가지도록 설계했습니다. Public 메서드를 상단에, Private 메서드를 하단에 배치하여 코드 구조를 명확하게 하였고, 메서드 분리와 일관된 네이밍 패턴을 통해 코드의 가독성을 크게 향상시켰습니다.
