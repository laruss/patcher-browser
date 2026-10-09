# Browser account security: план реализации

Статус: Phase 1 реализована, проверена и прошла независимое ревью.
Остальные фазы — план. План проверен по исходникам на `c263e6cab`,
2026-10-09, в ветке `codex/browser-security-phase-1`.

Область: раздел [TODO — First](../TODO.md#first--the-account-the-keychain-and-the-machines-own-locks).
Результат всей работы — браузер умеет сохранять и по решению человека заполнять
обычные логины; core обеспечивает хранение, ограничения доступа и системные
примитивы; менеджер остаётся отключаемым плагином. Sync, sharing, breach monitoring,
импорт чужих vault, универсальная поддержка всех форм и собственный WebAuthn
authenticator сюда не входят.

## Что подтверждено, а что в TODO устарело

Таблица описывает исходное состояние до реализации Phase 1.

| Тема                  | Состояние текущего кода                                                                                                                                           | Следствие для плана                                                                                                                     |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Desktop               | `apps/desktop/package.json`: только `darwin`, Electron закреплён на `41.7.0`; установленный пакет и `dist/version` совпадают                                      | Первый OS backend — macOS. Не добавлять Windows/Linux зависимости ради предполагаемого будущего                                         |
| Connect credential    | `apps/desktop/src/connect-credential-cache.ts` отсутствует; вызовов `safeStorage` в актуальном desktop source нет                                                 | Готового backend или безопасного fallback, на который можно опереться, нет                                                              |
| `secret: true`        | `plugin-settings.ts` читает файлы напрямую; `writeSecretFile` пишет UTF-8 через временный файл и rename, mode `0600`                                              | Это plaintext с файловыми правами, а не encryption                                                                                      |
| Settings metadata     | `buildPluginSettingsView` сначала вызывает `readPluginSettingsValues`, читая секреты, затем делает `stat` ради `{ set }`; возвращает исходную `schema`            | Экран настроек зря получает plaintext в серверной памяти; разрешённый `secret:true + default` попадает в публичную схему                |
| Другие secret files   | `readOrCreateSecretFile` обслуживает также app API key, machine auth secret, plugin HTTP token и telemetry id                                                     | Нельзя заменить поведение всего пакета на «нужен Electron»: сломается bootstrap и headless                                              |
| Plugin hosts          | `plugin-placement.ts`: установленные плагины обычно в отдельных Node-процессах, builtins в сервере; есть отключение process mode и fallback в `plugin-runtime.ts` | Это уже не прежняя архитектура «всё in-process», но процессы не sandboxed                                                               |
| Page scripts          | Изолированный мир на плагин, `page-script-preload.ts`, manifest membership; исполняются только в main frame                                                       | Изоляция JS globals не защищает DOM формы от кода страницы; subframes нельзя обещать как готовую возможность                            |
| Page RPC              | `browser-page-scripts.ts` переправляет вызов в обычный plugin RPC; метод не становится «безопасным» оттого, что вызван через isolated world                       | Нельзя делать `getPassword` доступным через этот канал или принимать `userApproved` из payload                                          |
| Site permissions      | `patcher.sites` ограничивает регистрации page scripts/styles, а не автоматически все `browser.*` команды                                                          | Runtime grant должен закрывать альтернативные пути вызова, иначе это только переключатель инъекции                                      |
| Secure Keyboard Entry | API присутствует в installed types, вызовов нет; готового потока password-field focus в коде не найдено                                                           | Формулировку TODO «shell уже знает» нельзя использовать как существующий API                                                            |
| WebAuthn              | Installed types **и официальные docs тега v41.7.0** содержат `app.configureWebAuthn({ touchID })` и `session` event `select-webauthn-account`                     | «Electron не поставляет macOS authenticator» — неверное обобщение. Сначала проверить настройку и сборку, а не писать свой authenticator |
| Подпись               | `build/entitlements.mac*.plist` не содержат `keychain-access-groups`; signing выбирает build script, возможна ad-hoc сборка                                       | Наличие метода не доказывает рабочие passkeys в распространяемом приложении                                                             |

Источники границ: [security](../security.md),
[migration invariants](bb-migration.md), [plugin permissions](plugin-permissions.md),
[plugin transport](plugin-transport.md), [browser surface](browser-surface.md),
[browser automation](browser-automation.md), [external access](browser-external-access.md).
Часть исторических архитектурных документов ещё говорит о будущем process split;
для placement использован текущий код. Значения Touch ID/UVPAA и зависание из TODO —
старые измерения, а не воспроизведённые этим планированием результаты.

## Границы доверия и выбранные ограничения

1. **Server владеет policy и persistence, Electron main — OS capabilities.**
   Node-server и plugin host не импортируют `electron`. Для первой версии
   encrypted storage поддерживается локальный runtime, запущенный этим desktop.
   Remote server, headless server и независимо запущенный local server остаются
   работоспособными, но новый password vault в них недоступен до появления
   проверенного backend. Просто URL на loopback не доказывает общую машину или
   общий data directory.
2. **Encryption at rest, биометрия и plugin sandbox — разные свойства.**
   OS-backed encryption защищает скопированный data directory без OS key.
   `promptTouchID` — проверка присутствия в приложении, не автоматический ACL
   keychain item. Неизолированный вредоносный плагин всё ещё может читать app key,
   запускать процессы и обходить HTTP permission gate. Этот план не выдаёт
   несандбоксированный плагин за безопасный код и не включает полный plugin sandbox.
3. **Обычные API tokens и интерактивные пароли имеют разную выдачу.**
   Существующий `settings.get()` возвращает собственному backend плагина секреты,
   в том числе при старте и в background service. Это сохраняется. Password vault
   использует отдельные операции и ключ; его нельзя открыть через settings,
   KV, обычный plugin RPC, tool result или универсальное `decrypt`.
4. **Сайт — недоверенный источник даже после grant.** URL, `origin`, тип поля,
   имя аккаунта, текст prompt и факт submit не являются разрешением пользователя.
   Решение принимается в доверенном chrome/native UI; origin и document identity
   перепроверяются в main перед capture/fill и после любого ожидания.
5. **Заполнение раскрывает пароль сайту.** DOM и обработчики страницы увидят
   заполненное значение. Плагин, которому разрешено читать эту страницу, и агент
   с `full`/evaluate тоже могут прочитать его после заполнения. Не обещать защиту
   от сайта-получателя, XSS на нём или уже выданного полного browser access.
6. **Браузерный wire остаётся совместимым.** Никаких новых полей в существующих
   strict browser IPC payloads. Новый канал + optional preload method + feature
   detection. Для функции с security semantics отсутствие capability означает
   отказ, а не переход на старый более широкий метод. Новый server ↔ desktop broker
   имеет собственную version/capability negotiation и не меняет host-daemon wire.
   Если позднее всё-таки затронут daemon contract — нужен protocol version bump.
7. **Разные поколения клиентов проверяются явно.** Новый renderer со старым shell,
   старый renderer с новым shell, окно после server upgrade. Не слать новые WS
   frame types клиентам без negotiation. Обновление plugin SDK/manifest нельзя
   выпускать так, чтобы старый host проигнорировал runtime mode и выдал wildcard.

## Порядок и зависимости

| Фаза    | Завершённый результат                                                            | Зависимости                                             |
| ------- | -------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Phase 1 | Settings metadata не читает и не раскрывает secret values/defaults               | Нет                                                     |
| Phase 2 | Проверенное поведение WebAuthn без бесконечного ожидания в поддерживаемом объёме | Нет; отдельная работа от vault                          |
| Phase 3 | Secure Keyboard Entry с корректным lifecycle                                     | Нет; можно переиспользовать security preload из Phase 2 |
| Phase 4 | OS-backed encrypted plugin settings и безопасная миграция                        | Phase 1                                                 |
| Phase 5 | Runtime site grants с UI и enforcement                                           | Независима от encryption; нужна до manager              |
| Phase 6 | Core capture/store/fill операции с проверкой человека и Touch ID policy          | Phases 3–5                                              |
| Phase 7 | Минимальный password-manager plugin                                              | Phase 6                                                 |
| Phase 8 | Native platform passkeys в проверенной подписанной сборке                        | Phase 2 и release signing; не зависит от manager        |

Номера задают удобный последовательный backlog, а не искусственные зависимости:
Phase 8 можно поднять сразу после Phase 2, когда есть signing identity. Устранение
WebAuthn зависания не должно ждать разработки password manager.

## Phase 1 — публичные настройки без чтения и утечки секретов

**Статус.** Реализована: targeted settings tests (17) и server typecheck проходят.
Независимое ревью `gpt-6.1-sol`, `xhigh`: раунд 1, P1/P2 не найдено;
повторный targeted run ревьюера — 17 tests passed.
Секретные файлы остаются plaintext `0600`; формат хранения не изменён.

**Проблема.** Даже запрос «настроен ли токен» читает его. При будущем locked backend
открытие Settings начнёт требовать unlock. Кроме того, `secret:true` допускает
`default:string`, а `schema` сейчас возвращается без редактирования.

**Минимальный результат.** GET settings и публичная часть ответа на PUT содержат
обычные эффективные настройки и `{ set: boolean }` для секретов; metadata path
не читает secret files. В schema нет secret default. Owning plugin продолжает
видеть прежние значения и defaults через `settings.get()`/`onChange`.

**Реализация в этой ветке, без расширения scope:**

1. В `apps/server/src/services/plugins/plugin-settings.ts` отделить вычисление
   обычных settings от чтения secret values. `buildPluginSettingsView` проходит
   по descriptors, читает только обычные значения из DB и проверяет наличие
   secret file. `readPluginSettingsValues` сохраняет прежнюю семантику.
2. Вернуть **копию** public schema, удалив `default` только у string descriptor
   с `secret:true`. Не мутировать зарегистрированные descriptors, иначе plugin
   backend потеряет default. Остальные поля/обычные defaults сохранить.
3. Сохранить значение `set`: существует сохранённое значение, включая пустую
   строку; default в исходниках плагина не превращается в сохранённый secret.
   Отсутствующий файл → false. Ошибка доступа/I/O → ошибка, не ложное false;
   текущий `stat(...).catch(() => false)` не должен скрыть будущую недоступность.
4. Не менять формат файлов, DB, SDK, контракты, UI, lifecycle plugin services
   или поведение `updateSettings`, которому prev/next нужны для `onChange`.
   PUT всё ещё может читать secrets ради backend callback; его **ответ** безопасен.

**Почему без нового store interface.** Сейчас исправление использует один backend
и один metadata path. Abstraction только ради будущего backend противоречит
AGENTS.md. Интерфейс вводится в Phase 4 при появлении второго реального backend.

**Точки изменения.** `plugin-settings.ts`, существующий
`apps/server/test/services/plugins/plugin-settings-storage.test.ts` и, если нужно
для изолированных FS spies, один небольшой unit test рядом с ним. Не менять
`packages/secret-storage` ради этого исправления.

**Meaningful tests / критерий завершения:**

- На исходном коде уже воспроизведены обе проблемы: secret default виден во всём
  JSON schema, а директория вместо secret file приводит metadata builder к
  `EISDIR` при чтении содержимого. Существующие 11 settings/storage tests проходят
  и эти регрессии пока не ловят. Для нового теста отсутствия чтения предпочтителен
  FS spy; directory fixture годится как простой дополнительный reproducer.
- GET settings с сохранённым sentinel secret и другим secret default: ни один
  sentinel не встречается во всём JSON ответа, включая schema; PUT ответ тоже
  не содержит их. Не проверять только `values`.
- Metadata test запрещает `readFile` для secret path (spy, который бросает),
  разрешая metadata lookup: view успешно строится. Проверять вызов builder после
  загрузки fixture, чтобы startup `settings.get()` не исказил тест.
- Отсутствующий/сохранённый/пустой secret → ожидаемые `set`; error кроме ENOENT
  не маскируется. Обычные boolean/string/select/project defaults и invalid stored
  values имеют прежние результаты.
- После построения view исходный descriptor не изменён; owning plugin всё ещё
  получает secret default, сохранённое значение и прежние `onChange` prev/next.
- Существующие settings route/storage tests проходят. Формат plaintext файлов
  остаётся прежним, ничего не мигрировано и не удалено.

Пример целевого запуска из корня (через Node runtime, не `bun test`):

```sh
bun run --cwd apps/server test test/services/plugins/plugin-settings-storage.test.ts
bun run --cwd apps/server typecheck
```

Добавленный unit test включить в тот же targeted run. Если native SQLite не
загружается, сначала штатный `bun run ensure-native-modules`; не пересобирать
зависимости под Electron ABI. Полная desktop packaging проверка здесь не нужна.

**Честная граница deliverable.** Это устранение конкретной утечки и лишнего
доступа. Данные по-прежнему plaintext `0600`; OS encryption, vault и Touch ID
после Phase 1 ещё отсутствуют. Эту фазу можно реализовать и завершить сейчас.

## Phase 2 — WebAuthn: измерение и предсказуемый отказ

**Проблема.** TODO описывает доступные JS interfaces и зависающий platform request.
Но текущий Electron уже имеет настройку платформенного authenticator, которой
приложение не пользуется. Нельзя строить решение на старом объяснении причины.

**Минимальный результат.** В unsupported режиме сайт получает предсказуемый отказ
для неподдерживаемого public-key flow и может показать password fallback; приложение
честно сообщает ограничения. Поддержка реальных ключей остаётся Phase 8.

**Порядок реализации:**

1. Добавить воспроизводимый Electron fixture на текущем pinned binary и локальном
   secure context. Записывать версию Electron/Chromium, тип подписи и результат
   feature detection, UVPAA, conditional mediation, create/get, native timeout
   и AbortSignal. Watchdog harness завершает тест и renderer при зависании; не
   принимать срабатывание watchdog за корректный reject страницы.
2. Сверить dev, ad-hoc packaged и signed packaged поведение. `typeof
app.configureWebAuthn === 'function'` — capability, а не свидетельство успешного
   platform authenticator. Только working signed path в Phase 8 включает native mode.
3. Для неподдерживаемой сборки реализовать минимальный compatibility adapter в
   отдельном **core security preload**, не в page script менеджера. В main world
   при document start перехватывать только public-key `create/get`, возвращать
   корректный rejected Promise (`NotAllowedError`); non-public-key calls делегировать
   исходному API. Не подделывать успешные credentials. Проверки доступности
   unsupported platform/conditional mode возвращают false согласованно с поведением.
4. Рекомендуемый первый unsupported mode отключает WebAuthn целиком **только если
   probe подтверждает отсутствие обслуживаемых transport'ов**. Если security key
   работает, нельзя определять каждый `get()` как platform-only: у него нет
   надёжного аналога `authenticatorAttachment` из `create()`. Тогда сохранять
   работающие transport'ы и ограничивать зависающие запросы watchdog + abort,
   проверив, что отменяется underlying ceremony, а не только внешний Promise.
5. Adapter не передаёт challenge, credential IDs или результаты в plugin RPC,
   лог или модель. Его установка не зависит от наличия плагина. Новая main-world
   функция не получает privileged bridge: это локальная корректировка web API.

**Критическая техническая проверка перед пунктом 3.** Installed types и docs
подтверждают `contextBridge.executeInMainWorld`, но он experimental; timing,
сохранение native Promise/error semantics и поведение subframes надо измерить.
Текущий session preload охватывает только main frame. Нельзя просто включить
`nodeIntegrationInSubFrames`, отключить sandbox или постоянно подключить CDP:
это меняет базовую модель безопасности и lazy-debugger invariant.

Если безопасный all-frame отказ на 41.7.0 не подтверждён, first patch можно
выпустить как явно ограниченный top-level workaround, но **не закрывать этим всю
Phase 2**. Оставшаяся работа — native cancellation/исправление в Electron либо
подтверждённое управление соответствующей Chromium capability на pinned версии.
Название blink flag нельзя угадывать. Это узкий исследовательский блокер данной
фазы; Phase 1 и storage от него не зависят. Наличие `select-webauthn-account`
не решает зависание до обнаружения аккаунтов.

**Точки изменения.** `apps/desktop/src/main.ts`, `desktop-browser-view.ts`, новый
`browser-security-preload.ts` и отдельный WebAuthn policy module,
`apps/desktop/scripts/build.mjs`, Electron fixtures/tests. Доверенное сообщение
о неподдерживаемости в chrome при необходимости получает новый optional IPC API.

**Проверка.** create/get platform, conditional get, pre-aborted signal, timeout,
reload во время ceremony, popup, same/cross-origin iframe, создание iframe после
load, первая inline script страницы, native non-public-key calls. На неработающей
конфигурации fixture действительно получает rejection; видимость интерфейса сама
по себе не считается поддержкой. DevTools не ломает поведение, debugger не
подключается ко всем вкладкам. Лимитация iframe остаётся в release note до устранения.

## Phase 3 — Secure Keyboard Entry

**Проблема.** Приложение не вызывает OS API. Готового надёжного события «фокус
в password field» нет, а глобальный флаг, забытый после blur/crash, мешает другим
приложениям и инструментам ввода.

**Минимальный результат.** На macOS secure input включён при вводе пароля и
обязательно выключается, когда необходимость закончилась. Это защита от внешнего
перехвата клавиш, не от JavaScript сайта, DOM reads или clipboard.

**Решение.** Один controller в main управляет app-global флагом по текущему
foreground window/webContents. Core preload посылает только boolean focus state,
не значения полей, key codes или селекторы. Main проверяет sender, живой документ,
активный view и окно; сообщения фоновой вкладки не могут выключить защиту другой.
Использовать focusin/focusout, изменения `type`, open shadow roots; обработать
password inputs host-owned auth dialog и settings UI отдельно. Ничего не
экспортировать сайту как `setSecureKeyboardEntry`.

**Рекомендуемое ограничение для subframes/closed shadow roots.** Пока нельзя
надёжно определить поле, консервативно включать secure input на время фокуса
такого неизвестного вложенного контекста в browser view. Для main frame с
известным обычным input выключать. Перед выпуском проверить, что этот fallback
действительно распознаёт неопределённое состояние; если нет, использовать более
широкий scoped режим «пока browser view сфокусирован», явно описав его цену для
keyboard utilities. Не заявлять точный per-field режим без измерения frames.

**Lifecycle.** Пересчитать состояние на focus/blur окна и webContents,
смене вкладки, navigation, detach, закрытии popup, `render-process-gone`, suspend,
screen lock и quit. Отмена одного окна не должна сбросить актуальный запрос
другого. После потери фокуса приложения состояние false. Windows/Linux —
явное отсутствие capability, без попытки вызвать macOS API.

**Точки изменения.** Новый controller в `apps/desktop/src`, `main.ts`,
`desktop-browser-view.ts`, core security preload; узкие IPC handler/schema для
boolean report и trusted UI. Не использовать существующие plugin script messages
для этой привилегии.

**Проверка.** Unit state-machine tests для двух окон, фоновых сообщений,
переключения вкладки и всех teardown paths. Electron smoke с
`app.isSecureKeyboardEntryEnabled()` для password → обычное поле → address bar →
другое приложение, iframe, popup, crash. Проверить ввод/IME и отсутствие значений
полей в IPC/logs. Любой завершённый test оставляет secure input выключенным.

## Phase 4 — encrypted plugin settings и миграция

**Проблема.** Node-сервер хранит secrets plaintext и не имеет собственного
OS backend. Глобально заменить `readOrCreateSecretFile` нельзя: app key нужен,
чтобы система вообще загрузилась.

**Минимальный результат.** Для desktop-owned local server существующие
`secret:true` settings можно перевести в OS-backed encrypted storage без потери
данных. Обычный background plugin получает свои tokens как раньше, пока backend
доступен. Отсутствующий backend не приводит к plaintext fallback для защищённой
записи. Password vault здесь ещё не появляется.

### Хранилище и bridge

- Ввести узкий server-owned store `get/set/delete/has`, scoped к plugin ID,
  выбранному сервером. Два backend теперь реальны: legacy plaintext и encrypted.
  `has` не расшифровывает запись и работает при закрытом keychain.
- Вынести ошибки `unavailable`, `locked/denied`, `corrupt`, `unsupported_version`
  отдельно от отсутствующей записи. Только отсутствие позволяет использовать
  setting default; locked/corrupt не превращаются в undefined или default.
- Electron main использует `safeStorage` только после ready и проверки backend.
  Не вызывать `setUsePlainTextEncryption(true)`. Для будущей Linux реализации
  `basic_text` не считается OS-backed даже при доступном API; сейчас UI сообщает
  unsupported platform. `safeStorage` не импортируется в server/plugin packages.
- Рекомендуемая конструкция: один случайный data key для **обычных plugin
  settings**, wrapped через `safeStorage` в main; сервер шифрует записи
  `node:crypto` AES-256-GCM с уникальным nonce и AAD, включающим format version,
  store ID, namespace, plugin ID и setting key. Это обеспечивает проверку
  повреждения и не позволяет перенести ciphertext между владельцами. Не писать
  собственную криптографию или производить ключ из app key/machine ID.
- Wrapped key и versioned encrypted records лежат в отдельном namespace, не
  на месте старого UTF-8 secret file. Secret values, plaintext key и IV/tag
  диагностические дампы не попадают в argv/env/stdout/logs. Файлы `0600`,
  directories `0700`; namespace/key validation на server boundary обязательна.
- Broker main ↔ owned runtime — отдельный локальный IPC канал с небольшим
  versioned vocabulary, size/time bounds, correlation и cancellation. Передать
  capability через inherited private pipe/IPC FD в launcher/server, не через
  app renderer, URL, app key file или browser-host claim. Изменение launcher
  должно ограничить наследование pipe сервером; daemon и plugin children его
  не получают. Console stdout остаётся логом, не secret transport.
- `startPatcherAppProcess` и launcher могут иметь промежуточные процессы:
  проследить реальный spawn path, прежде чем выбирать FD. У текущего
  `patcher-app-bridge.ts` нет готового secret channel. Протокол должен нормально
  отработать startup без broker и reconnect; отсутствие channel не мешает
  серверу обслуживать незатронутые функции.
- Никакого универсального `safeStorage.decrypt(ciphertext)` на публичном HTTP,
  renderer preload или plugin channel. У обычного store выдача определяется
  authenticated owner; у будущего vault будет другая операция и другой ключ.

### Совместимость и выдача

- `plugin-settings.ts`, `plugin-service.ts` и `plugin-runtime.ts` получают один
  серверный store; plugin process читает через существующий settings channel.
  Валидировать descriptors/keys из `settings.<handle>.get` **на стороне сервера**:
  сейчас `plugin-host-call-server.ts` делает cast `args.descriptors as never`.
  Проверка должна работать и для load-safe `get()` во время factory; нельзя
  требовать ещё не завершённую регистрацию. Owner берётся из capabilities,
  никогда из payload. Запретить traversal и подмену namespace.
- Новый encrypted backend не выдаётся plugin child как путь к key или capability.
  Любая поддержка SDK secrets в будущем проходит тот же owner gate; `storage.kv`
  и plugin database не становятся шифрованными автоматически.
- Для ordinary token settings data key разрешено держать в памяти сервера на
  время подключённого broker; disconnect/lock/suspend очищает ссылку и запрещает
  новые decrypt. JS strings и уже выданные plugin tokens нельзя гарантированно
  стереть: lock не отзывает то, что плагин успел получить. Фабрика с недоступным
  encrypted token получает понятный needs-configuration/locked status, без
  бесконечного restart loop и без остановки всего сервера.
- Ошибки frontend не содержат секрет или ciphertext. Metadata остаётся доступной.
  `updateSettings` сейчас читает все prev/next ради listeners: отдельно решить
  и проверить partial update при locked store. Рекомендация для первой версии —
  явный отказ update этого plugin до unlock, а не частичное изменение и не
  отправка ложных prev/next. GET настроек продолжает работать.

### Матрица runtime

| Сценарий                                           | Ordinary plugin settings                                                           | Новый password vault                                                       |
| -------------------------------------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Local desktop-owned, OS backend доступен           | Encrypted после включения/миграции                                                 | Возможен с Phase 6                                                         |
| Тот же store, shell закрыт или keychain недоступен | Encrypted records остаются; metadata доступна, чтение/запись секрета отказывают    | Закрыт                                                                     |
| Headless/remote/отдельный local server без broker  | Существующий legacy режим сохраняется и называется plaintext; никакой автомиграции | Недоступен                                                                 |
| Data dir скопирован на другую машину               | Ошибка недоступного ключа; без overwrite/re-key                                    | Недоступен до восстановления нужного OS key, иначе ввод credentials заново |
| Устаревший shell/server                            | Функция не включается без согласованной capability                                 | Недоступен                                                                 |

Это сознательное ограничение первого backend: remote server не получает права
дешифровать локальный vault пользователя только потому, что к нему открыли окно.
Нативный headless keychain adapter или remote pairing — отдельное последующее
решение при реальной потребности, не часть текущих фаз.

### Миграция без потери данных

1. Включение encrypted mode — явный шаг в host-owned Settings с указанием
   последствий для headless запуска, downgrade и восстановления. Само открытие
   Settings и startup не мигрируют данные и не вызывают biometric prompt.
2. До изменения источника проверить OS backend, создать и durably записать
   wrapped data key, успешно unwrap; сериализовать writes/migration/delete для
   одного store. Не мигрировать app key, machine auth, HTTP token или telemetry
   через общую замену utility.
3. Для каждого legacy secret сохранить **точные bytes/string**, включая newline,
   Unicode и пустую строку. Encrypt → temp ciphertext в том же target directory
   → fsync/rename/directory durability → read/decrypt/compare. До успешной проверки
   исходный plaintext не удалять.
4. Versioned migration state без secret values отмечает готовую запись. После
   durable ciphertext удалить legacy source. Crash между этими шагами оставляет
   восстанавливаемую пару, а не потерянный secret. Cleanup plaintext после crash
   обязан завершаться при следующем запуске, до сообщения «миграция завершена».
5. При наличии encrypted record она авторитетна. Ошибка расшифровки не разрешает
   прочитать старую plaintext копию. При незавершённой миграции два расходящихся
   значения дают конфликт, а не молчаливый выбор. Delete удаляет/фиксирует обе
   формы так, чтобы следующая загрузка не воскресила legacy значение.
6. Миграция возобновляема и идемпотентна; включает secrets отключённых/ошибочных
   плагинов через inventory старого namespace, не только loaded descriptors.
   Неизвестные entries сохранять и показывать как необработанные, не удалять.
7. Не создавать новые plaintext `.bak`. Старые backups/снимки файловой системы
   уже могут содержать secrets; unlink не обещает физического стирания SSD.
   Копия ciphertext без OS key не является переносимым backup. Сначала проверить
   восстановление на том же keychain; recovery/export функциональность не добавлять.
8. Старый бинарник может вновь создать legacy файл и не поймёт encrypted state.
   Рекомендация: encryption activation повышает минимальную поддерживаемую data
   version; downgrade после него не поддерживается и не выполняется автоматически.
   Новый код обнаруживает возникшие legacy/conflicting files и не понижает режим.
   Version guard в поддерживаемом launcher должен отказаться от такого запуска;
   произвольный старый бинарник, запущенный вручную, заставить соблюдать новый
   guard невозможно. Поэтому обещания transparent downgrade нет, а detection
   legacy/conflicts при возвращении на новый код обязательна.

**Точки изменения.** `packages/secret-storage/src` (новые отдельные primitives,
не изменение bootstrap helpers), `apps/server/src/services/plugins/plugin-settings.ts`,
`plugin-runtime.ts`, `plugin-service.ts`, `plugin-host-call-server.ts`,
`apps/server/src/start-server.ts`; `apps/desktop/src/main.ts`, `patcher-process.ts`,
`patcher-app-bridge.ts`; фактический launcher path в `packages/patcher-app/src`;
новый broker module, Settings status/activation UI, data version guard.

**Проверка.** Unit encryption tests: wrong owner/AAD, altered ciphertext,
truncation, unknown version, empty/Unicode value. Migration tests с fault injection
после каждого durable шага, повторным запуском и конкурентными set/delete.
Plugin tests для in-process и настоящего child process, forged descriptor/key,
запроса чужого owner, locked get/metadata/update. Sentinel не находится в DB,
новых файлах, IPC logs и process env. Fake cipher недостаточен: обязательный
macOS Electron smoke encrypt → restart main+server → decrypt; unavailable backend,
keychain denial, disconnected shell, перенос data dir без ключа. Проверить dev
и packaged signing behaviour. Existing app-key/headless startup tests не меняются
по смыслу и проходят. Dependency/packaging изменения требуют проверок из
`bb-migration.md`; новый keytar/native addon для первого backend не нужен.

## Phase 5 — runtime site grants и видимые permissions

**Проблема.** Manifest wildcard сегодня — standing access ко всем matching pages.
Password plugin должен просить «использовать здесь» по мере появления аккаунтов.
Просто отфильтровать page script list недостаточно.

**Минимальный результат.** Плагин с явно объявленным runtime mode не получает
доступ к сайту до решения человека. Grant привязан к `(pluginId, exact origin)`:
scheme + canonical hostname + effective port, без наследования поддоменам.
Manifest `sites` остаётся потолком, регистрации выбирают его элементы verbatim.

**Решения:**

- Добавить opt-in manifest поле режима, например `siteAccess: 'runtime'`.
  Окончательное имя закрепить в manifest schema/SDK. Legacy плагины сохраняют
  существующую семантику; runtime mode без persisted grant — deny.
  Password manager обязан использовать runtime mode; широкую декларацию показывать
  как «может запрашивать доступ», отдельно от уже разрешённых origins.
- UI на текущей странице: имя плагина, точный origin, что получает, Allow here/Deny.
  Settings plugin detail показывает permissions, ceiling patterns и granted
  origins с Revoke. UI позволяет выдать grant и для известного текущего origin
  без регистрации page script на нём заранее.
- Grant/revoke — core operation. Thread key, agent access grant, plugin identity,
  generic plugin RPC, timer и DOM `click` не могут сами одобрить grant. App key
  по существующей модели — доверенный local client, но для этого security-sensitive
  решения требовать host-owned confirmation; один POST с `allow:true` недостаточен.
  Отсутствие доверенного desktop в MVP = отказ, а не pending навсегда.
- Effective access: объявленная permission ∩ manifest pattern match для реального
  URL ∩ активный origin grant. Membership registration rule не заменяется
  вычислением containment между glob patterns. Сверять origin через URL parser,
  покрыть IDN/punycode/default ports; `file:`, `data:`, opaque origins запрещены.
  Для password manager HTTPS обязателен; loopback HTTP только тестовые fixtures.
- Гейт до исполнения: injection, **каждый** page RPC, browser reads/actions/evaluate,
  auth provider, page-scoped toolbar/site-info callbacks и secret fill. Для
  runtime-scoped plugin запретить пока неподдерживаемые session-wide storage,
  cookies enumeration и network interception; не обходить origin grant через
  команды, которым нельзя однозначно назначить origin. `tabs.read` и прочие
  metadata permissions не выдавать manager без необходимости.
- Server проверяет owner/grant/revision до отправки; main повторно проверяет
  фактический URL/document прямо перед исполнением. Одного предварительного
  `tabs.get()` недостаточно из-за navigation race. Нужен новый scoped command
  channel/capability, не optional field в старой strict command schema.
- Старый shell не может исполнять runtime-scoped page operations. Не превращать
  exact origin в более узкий glob и не посылать его старому `setPageScripts` как
  достаточную замену revoke enforcement. Runtime plugin требует minimum SDK/host
  version, на котором новая семантика понятна.
- Grant хранится в core DB, не plugin KV; сохраняется при обычном restart/reload.
  Disable блокирует немедленно, uninstall удаляет. При расширении manifest
  ceiling/permissions или смене source identity требуется новое подтверждение;
  старые grants не расширяются вместе с wildcard. Удалённый из ceiling origin
  перестаёт работать независимо от persisted grant.
- Revoke закрывает pending prompts/operations и channel сразу. Уже запущенный JS
  нельзя «разинъектировать», а прочитанные байты нельзя вернуть. Поэтому для
  полного прекращения присутствия script нужно перезагрузить затронутые документы
  с согласованной UI семантикой; до reload показывать pending cleanup, а не
  «код больше не работает». Не перезагружать молча заполненную форму.

**Точки изменения.** `apps/server/src/services/plugins/manifest.ts` и SDK contract,
`packages/domain/src/browser-url-pattern.ts`, `plugin-declared-sites.ts`,
`plugin-registration-guard.ts`, `plugin-permission-gate.ts`,
`plugin-host-call-server.ts`, server browser bridge/caller context,
`packages/db`, plugin routes и permission route coverage;
`apps/app/src/components/settings/PluginsSettingsSection.tsx`, site-info UI,
`apps/app/src/lib/browser-page-scripts.ts`, desktop main/view/preload,
новые desktop/server contract capabilities и fake plugin host.

**Проверка.** Table tests для origin/port/subdomain/IDN и manifest ceiling.
Negative integration tests: forged plugin frame, обычный HTTP вызов, page RPC,
agent и background service не обходят grant; direct evaluate/storage не становятся
запасным входом. Allow на A не разрешает B; grant нельзя расширить аргументом URL.
Navigation/revoke во время ожидания, plugin disable/reload/update/uninstall,
две windows и renderer reconnect. Обязательно старый/new shell matrix.
Живой hostile fixture после revoke не получает backend ответы; наличие старого
JS до reload показано честно. Существующие legacy site plugins не ломаются.

## Phase 6 — core операции с паролем и проверка человека

**Проблема.** Ordinary secret store выдаёт значение plugin backend без участия
человека. Это нужно для API token, но не подходит для «вставить мой пароль на сайт».
Делать `promptTouchID()` в самом password plugin нельзя: другой путь его пропустит.

**Минимальный результат.** Core умеет сохранить один scoped credential и заполнить
его по reference в живую форму после решения человека. Это primitives, ещё не
менеджер аккаунтов. Тестовый fixture/plugin демонстрирует работу API.

**Рекомендуемая граница API:**

- Manager хранит account metadata и opaque credential reference; защищённая
  запись дополнительно связывает owner, exact origin, account ID, version и policy.
  Изменение plugin metadata не меняет origin защищённой записи.
- Добавить отдельную permission для protected credential operations, отличную
  от `page.credentials` (сейчас это cookies) и обычных settings. Проверять её на
  server side и в fake host, не только внутри SDK helper.
- Core capture/save/update принимает user intent, tab/document/form identity;
  main извлекает значение из выбранного password field только после проверок.
  Core fill принимает reference и подтверждённую цель, возвращает status.
  **Не добавлять `getPassword`, general reveal, export или clipboard API в MVP.**
  Это позволяет оставить выбор аккаунта/UX в плагине, не отдавая plaintext его
  scripts, RPC results и инструментам агента.
- Для vault — отдельный key, который остаётся в Electron main; server хранит
  ciphertext и управляет policy/owner. Ordinary settings key из Phase 4 не
  расшифровывает vault. Main выполняет scoped seal/open-to-fill через private
  broker; generic ordinary-settings decrypt отвергает protected namespace.
  Plaintext capture → main → encryption → server; fill → main → выбранное поле.
  App SPA, plugin backend и agent transcript получают metadata/status.
- Подтверждение host-owned: origin, аккаунт, операция, инициатор. Reference,
  документ и pending request связываются server/main с одноразовым ID, коротким
  сроком жизни и подтверждённым window; `approved:true`/origin от plugin не
  принимаются. Дубликат/late response/другой sender не разрешает операцию.
- Первая policy — **подтверждать каждый fill**, без постоянного unlock и таймера
  «доверять пять минут». Если Touch ID доступен и включён, release только после
  успешного `promptTouchID`. Cancel/failure/timeout = отказ; без тихого fallback.
  После prompt снова проверить origin, document, visibility, grant и credential
  version, затем заполнить ровно один раз. Отмена/navigation/revoke/disconnect
  делает поздний успех Touch ID бесполезным.
- Для машины без Touch ID рекомендуемый явный режим — OS-backed encryption +
  подтверждение человеком в chrome при каждом fill. Выбирается при первом
  включении manager и называется без «biometric protection». Если пользователь
  выбрал Require Touch ID, unavailable означает закрытый vault. Не имитировать
  OS password fallback собственным dialog: `promptTouchID` не предоставляет
  универсальную замену системной аутентификации.
- Save нового credential/update/delete требуют явного host decision; update/delete
  нельзя исполнять автоматически по недоверенному submit. Для Require Touch ID
  применять ту же auth policy к изменениям. Сайт не может вызвать prompt loop:
  pending slot/rate limit per tab, запуск только из разрешённого пользовательского
  flow, disable/cancel завершают все ожидания.
- Синтетическая browser automation не является user presence. Thread/grant вызов
  может максимум предложить человеку запрос без plaintext результата; default
  MVP — запрет прямого vault API для агентов. Никакой обычный браузерный permission
  или command correlation не считается автоматически согласием на password release.

**Ограничения.** Это application-level enforcement для Patcher-controlled путей.
`safeStorage` + `promptTouchID` не превращается в keychain ACL
`kSecAccessControlUserPresence`; гарантии против полностью скомпрометированного
main/server или произвольного процесса того же пользователя не добавляются.
Нужна более сильная гарантия — отдельный проект sandbox/native keychain policy,
не скрытая предпосылка этой фазы. Передача в DOM делает secret доступным сайту.

**Точки изменения.** Новый core credential service/record schema в server,
protected broker operations в desktop, `packages/plugin-sdk/src/backend-contract.ts`,
permission map и plugin transport allowlist, новые optional browser capabilities,
host-owned prompt UI/IPC, input/capture helpers. Не использовать
`registerAuthProvider` как форму API: он предназначен для HTTP authentication.

**Проверка.** Матрица success/cancel/failure/unavailable/late success с fake auth
и отдельным macOS smoke; context swap A→B за время fingerprint никогда не
заполняет B. Replay operation ID, forged approval, plugin owner swap, modified
record origin, expired reference, disconnected server/main, revoke и stale
document дают отказ. Прямой generic decrypt не читает vault ciphertext; обычный
settings token всё ещё работает в background. Sentinel отсутствует в UI props,
plugin transport, tool results, traces/network recorders/logs; core sensitive
operation не сериализуется как обычный browser `fill` command с `text` в trace.
Проверить существующие AX snapshots/read helpers на password value и редактировать
их при необходимости; это не обещает скрыть secret от `evaluate` после fill.

## Phase 7 — минимальный password-manager plugin

**Проблема.** Primitives сами не дают пользователю списка аккаунтов и Save/Fill UX.

**Минимальный результат.** Отключаемый first-party plugin, установленный/включённый
явно: Save new login, Update existing login, Choose account and Fill, Delete.
Использует только уже проверенные core primitives. Не получает wildcard access
при установке; broad manifest ceiling становится доступом лишь после site grant.

**Поведение первой версии:**

- Toolbar action и plugin panel/settings показывают текущий origin, наличие
  аккаунтов и доступность backend. Плагин выбирает account reference и просит
  core исполнить fill. Первое действие «Use here» использует Phase 5.
- Page script после grant на HTTPS main frame распознаёт обычную форму с одним
  username/email и одним password field, стандартный submit и динамическое
  появление полей. Передаёт только сведения о кандидате/opaque capture ID,
  не password в generic RPC. Core может держать короткоживущий candidate после
  submit для prompt; max lifetime и размер обязательны, после отказа удаляется.
- Save prompt не утверждает, что вход успешен: форма могла вернуть ошибку.
  У пользователя остаётся ручное «Save login» для непойманного SPA flow.
  Update требует выбора существующего account, не перезаписывает автоматически.
- Fill только после явного выбора человека; не запускать на page load/focus,
  не auto-submit. Exact origin, только видимые enabled поля выбранной формы;
  hidden/readonly, неоднозначные формы и cross-origin action отклоняются в MVP.
  Повторная проверка цели непосредственно при записи исключает DOM swap race.
- Subframes, cross-origin iframes, закрытый shadow DOM, несколько password полей,
  password-change/signup flows и сложные multi-step logins — понятный unsupported
  result, не эвристика, которая может записать пароль не туда. Обычный ручной ввод
  остаётся доступным. HTTP auth provider можно подключить отдельным последующим
  slice, но это не критерий минимального form manager.
- Не выводить пароль в panel/omnibox/notification. Metadata поиска ограничить
  origin/username; полные URL/query могут содержать tokens и не нужны record key.
  Plaintext password не хранится в plugin DB/KV. Private fields не включать в
  history, screenshots prompt UI, telemetry, crash metadata или action logs.
- Disabling manager немедленно прекращает actions/prompts и отзывает его active
  capabilities; encrypted records сохраняются. Удаление records — отдельное явное
  действие, uninstall не должен уничтожать их неожиданно. Решение о повторном
  использовании данных при reinstall требует того же owner/source identity,
  а не доверия одному совпавшему package name.

**Точки изменения.** Новый first-party plugin по текущему примеру
`examples/plugins/bookmarks`, но включение в builtin registry/packaged artifacts
обсудить как решение доставки. Предпочтение: opt-in bundled plugin, чтобы не
требовать сетевой установки, с отдельной permission declaration и тестами.
Core перестаёт расти после готовых Phase 6 primitives; особые поля под этот UI
не добавляются в универсальный settings API.

**Проверка.** HTTPS fixture для save/restart/list/fill/update/delete, два аккаунта,
неправильный пароль, submit без navigation, динамическая форма. Hostile fixture:
подмена action/origin, hidden field, spoofed save banner, forged page RPC,
navigation на похожий hostname, DOM mutation между prompt/fill, revoked grant.
None из них не выдаёт password без предусмотренного human action. Real plugin
process test, tests с fake host, packaged smoke после restart и locked backend.
Проверить возможность выключить plugin, продолжать вводить вручную и не потерять
credentials. **Готовность manager = Phases 4–6 пройдены, а не только удачный fill.**

## Phase 8 — native platform passkeys

**Проблема.** Нужен рабочий platform authenticator в выпускаемой сборке и UI выбора
account, а не только доступный метод или успешный тест с virtual authenticator.

**Минимальный результат.** Подписанный macOS desktop с подходящим оборудованием
делает реальную create/get ceremony через Electron/OS; unavailable build остаётся
в проверенном unsupported режиме Phase 2. Passkeys принадлежат Chromium/OS,
не password plugin и не server secret store.

**Решения и шаги:**

1. Подготовить стабильные Team ID, bundle ID и `keychain-access-groups`, проверить
   effective signing entitlements готового `.app`, не только plist в source.
   Release script должен собирать access group из реальной signing configuration;
   не вставлять выдуманный Team ID. Dev/ad-hoc path не выдавать за signed support.
2. Настроить `app.configureWebAuthn` до первых browser ceremonies, после нужной
   стадии app startup; использовать непустой понятный `promptReason` и group,
   соответствующий подписи. Не менять pinned Electron лишь ради latest docs:
   в 41.7.0 достаточно подтверждённого `touchID` API. Иные поля из более новых
   версий, например `platformPasskeys`, сейчас не входят в installed contract.
3. На browsing session обработать `select-webauthn-account` в доверенном UI.
   Показывать RP ID и имена из Chromium как недоверенный текст, не HTML. Account
   selection callback вызывается **ровно один раз**; cancel/timeout/исчезнувший
   `details.frame`/navigation/shutdown дают пустой callback, не вечное ожидание.
   UI не принимает произвольный credential ID вне списка текущего запроса.
4. Сохранить существующий browser partition и профиль. Native credentials здесь
   device-bound; metadata secret per session не копировать/не сбрасывать при
   обычном обновлении. Не обещать iCloud sync, portable backup или работу после
   потери Secure Enclave/keychain/profile. Очистка browser data должна отдельно
   объяснять последствия для passkeys до разрушительного действия.
5. При включённом native mode отключить incompatible fallback adapter Phase 2.
   UVPAA/conditional behaviour определяются проверенной нативной конфигурацией,
   не подменой true. Touch ID для vault и WebAuthn user verification не смешивать.

**Точки изменения.** `main.ts`, browser session setup/view lifecycle, новый
account chooser/prompt module и optional IPC capability при renderer UI;
`apps/desktop/build/entitlements.mac.plist`, build/signing script/config,
packaging tests и Electron secure-origin fixtures.

**Проверка.** Реальный signed packaged app: create → quit/relaunch → get,
несколько accounts, cancellation, timeout/abort, iframe policy, popup,
navigation/closed frame, другой origin/RP, другой partition, обновление build
с той же signing identity. Ошибочная подпись/group и отсутствие Touch ID дают
честный отказ, не loss/reinitialization. Отдельно измерить hardware security key,
чтобы fallback не сломал ранее рабочий transport. Виртуальный CDP authenticator
годится только для protocol fixture; он не проверяет Secure Enclave/signing.
Если подписи/устройства нет, unit checks можно закончить, phase acceptance — нет.

## Решения, которые нужно подтвердить до соответствующей реализации

| Решение                                  | Рекомендуемый вариант и причина                                                                                                                                               | Когда блокирует |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| Где находится первый vault               | На машине desktop-owned local server; remote/headless пока unsupported. Это предотвращает неявную передачу локальных секретов удалённому серверу и ограничивает первый broker | Phase 4         |
| Что делать со старыми tokens без backend | Сохранять совместимый legacy mode с честным статусом; никогда не понижать уже encrypted record и не создавать password vault в plaintext                                      | Phase 4         |
| Мигрировать автоматически ли             | Явно включаемая миграция с resumable state; пользователь понимает зависимость от desktop и downgrade. Никакого удаления до проверенного ciphertext                            | Phase 4         |
| Touch ID отсутствует                     | Явный режим OS encryption + подтверждение каждого fill; Require Touch ID всегда fail closed. Не реализовывать свой master password в этом scope                               | Phase 6         |
| Session unlock                           | Не добавлять в MVP; каждый fill имеет своё разрешение, меньше lifetime/race/replay состояний                                                                                  | Phase 6         |
| Может ли plugin прочитать пароль         | MVP API выдаёт handle/status и выполняет scoped fill в core. Обычный `settings.get()` остаётся для tokens, не vault                                                           | Phase 6         |
| Delivery manager                         | Opt-in bundled first-party plugin. Пользователь может выбрать другой manager и выключить этот                                                                                 | Phase 7         |
| Подпись для passkeys                     | Использовать реальную стабильную signing identity; до её готовности честный unsupported path. Не писать собственный authenticator                                             | Phase 8         |

Эти рекомендации дают реализацию без выбора «на глаз». Они не требуют нового
подтверждения для Phase 1: её scope не меняет хранение и продуктовые permissions.
Если выбирается иной вариант remote vault, master password или постоянного unlock,
нужно пересмотреть связанные фазы **до** написания их кода.

## Общий критерий завершения

Каждая фаза сдаётся отдельно с targeted tests и указанными реальными smoke checks.
Ни зелёный TypeScript, ни fake OS backend, ни отсутствие literal sentinel в одном
файле не доказывают весь security claim. Проверять соответствующую границу:
metadata не читает secret; migration переживает crash; locked backend не отдаёт
default; grant не обходится соседним API; отменённый prompt не выпускает пароль;
подписанная Electron сборка действительно выполняет WebAuthn.

После реализации каждой фазы отправить её на независимое ревью саб-агенту
`gpt-6.1-sol` с effort `xhigh`. Исправить найденные P1/P2, проверить исправления
и отправить повторно, пока таких замечаний не останется. Максимум — три раунда
ревью на фазу; если после третьего остались P1/P2, явно сообщить об этом.
Коммитить и пушить только после отдельного указания пользователя.

После реализации конкретной фазы обновить соответствующие TODO/security/authoring
claims теми гарантиями, которые доказаны. Остальные фазы этого плана остаются
невыполненными до прохождения их собственных критериев проверки.

## Первичные API-источники

- [Electron 41.7.0: app.configureWebAuthn и Secure Keyboard Entry](https://github.com/electron/electron/blob/v41.7.0/docs/api/app.md).
  Сверено с installed `electron.d.ts`; настройка authenticator требует matching
  entitlement, credentials device-bound.
- [Electron 41.7.0: select-webauthn-account](https://github.com/electron/electron/blob/v41.7.0/docs/api/session.md#event-select-webauthn-account).
  Документирует pending callback и отмену через пустой ответ.
- [Electron 41.7.0: safeStorage](https://github.com/electron/electron/blob/v41.7.0/docs/api/safe-storage.md).
  Это OS-backed encryption API; доступность и платформенная защита различаются.
- [Electron 41.7.0: promptTouchID](https://github.com/electron/electron/blob/v41.7.0/docs/api/system-preferences.md#systempreferencesprompttouchidreason-macos).
  Проверка сама по себе не защищает данные; keychain access control — отдельный механизм.
- [Electron 41.7.0: contextBridge](https://github.com/electron/electron/blob/v41.7.0/docs/api/context-bridge.md#contextbridgeexecuteinmainworldexecutionscript-experimental)
  и [WebPreferences](https://github.com/electron/electron/blob/v41.7.0/docs/api/structures/web-preferences.md).
  Подтверждают main-world execution API и цену включения preload в subframes;
  рабочий all-frame adapter этим планированием не доказан.
