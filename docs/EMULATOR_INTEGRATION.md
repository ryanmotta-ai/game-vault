# Game Vault — Emulator Integration & Adapter Reference (Phase 4A) 🕹️✨

## 1. Overview

O Game Vault conecta jogos clássicos diretamente aos seus respectivos motores de emulação nativos sem exigir configuração prévia pelo usuário. O subsistema é baseado no padrão **Adapter**, permitindo que cada emulador especifique:
- Executáveis padrão conhecidos
- Diretórios padrão de instalação do Windows
- Construção determinística de parâmetros CLI
- Resolução de núcleos (no caso de motores multi-sistema como RetroArch)
- Validação do executável

---

## 2. Supported Platforms & Adapters Matrix

| Plataforma | Emulador Padrão | Adapter ID | Executáveis Suportados |
|:---|:---|:---|:---|
| **PlayStation 2** | PCSX2 | `pcsx2` | `pcsx2-qt.exe`, `pcsx2.exe` |
| **PlayStation (PS1)** | DuckStation | `duckstation` | `duckstation-qt.exe`, `duckstation-nogui.exe`, `duckstation.exe` |
| **GameCube** | Dolphin | `dolphin` | `Dolphin.exe`, `dolphin-emu.exe` |
| **Wii** | Dolphin | `dolphin` | `Dolphin.exe`, `dolphin-emu.exe` |
| **PSP** | PPSSPP | `ppsspp` | `PPSSPPWindows64.exe`, `PPSSPPWindows.exe`, `ppsspp.exe` |
| **NES** | RetroArch | `retroarch` | `retroarch.exe` |
| **SNES** | RetroArch | `retroarch` | `retroarch.exe` |
| **Game Boy** | RetroArch | `retroarch` | `retroarch.exe` |
| **Game Boy Color** | RetroArch | `retroarch` | `retroarch.exe` |
| **Game Boy Advance** | RetroArch | `retroarch` | `retroarch.exe` |
| **Nintendo 64** | RetroArch | `retroarch` | `retroarch.exe` |
| **PC (Windows)** | Native PC | `native_pc` | Executável nativo extraído (`.exe`) |

---

## 3. CLI Argument Specifications

Cada adaptador compõe seus argumentos de forma determinística e segura:

### 3.1 PCSX2 (PlayStation 2)
```text
pcsx2-qt.exe [-fullscreen] -batch [customArgs...] -- "D:\Jogos\Gran Turismo 4\GT4.chd"
```
- `-fullscreen`: ativado por padrão se `profile.fullscreen !== false`.
- `-batch`: fecha automaticamente a interface do PCSX2 quando o jogo é encerrado.
- `--`: delimitador oficial do PCSX2 indicando o fim das opções de linha de comando.

### 3.2 Dolphin (GameCube & Wii)
```text
Dolphin.exe -b [-f] [customArgs...] -e "D:\Jogos\Super Mario Sunshine.iso"
```
- `-b`: modo batch (executa a ROM diretamente e encerra com o jogo).
- `-f`: executa em modo tela cheia.
- `-e`: especifica o caminho do arquivo executável/imagem de disco.

### 3.3 DuckStation (PlayStation)
```text
duckstation-qt.exe -batch [-fullscreen] [customArgs...] -- "D:\Jogos\Tekken 3.chd"
```
- `-batch`: inicialização direta do jogo.
- `-fullscreen`: tela cheia.
- `--`: separador de argumentos de ROM.

### 3.4 PPSSPP (PlayStation Portable)
```text
PPSSPPWindows64.exe [--fullscreen] [customArgs...] "D:\Jogos\Crisis Core.iso"
```
- `--fullscreen`: inicia diretamente em tela cheia.

### 3.5 RetroArch (Multi-System Libretro)
```text
retroarch.exe -L "C:\Emulators\RetroArch\cores\snes9x_libretro.dll" [-f] [customArgs...] "D:\Jogos\Super Mario World.sfc"
```
- `-L <core>`: especifica o caminho absoluto para o núcleo Libretro correspondente.
- `-f`: inicialização em tela cheia.

---

## 4. RetroArch Core Registry

O `RetroArchCoreRegistry` mapeia plataformas para seus núcleos Libretro recomendados em ordem de preferência:

| Plataforma | Núcleos Suportados (em ordem de preferência) |
|:---|:---|
| **NES** | `mesen_libretro`, `fceumm_libretro`, `nestopia_libretro` |
| **SNES** | `snes9x_libretro`, `bsnes_libretro` |
| **Game Boy** | `gambatte_libretro`, `mgba_libretro` |
| **Game Boy Color** | `gambatte_libretro`, `mgba_libretro` |
| **Game Boy Advance** | `mgba_libretro`, `vba_next_libretro` |
| **Nintendo 64** | `mupen64plus_next_libretro`, `parallel_n64_libretro` |

A resolução de núcleos busca sequencialmente:
1. Pasta `<retroarch_working_directory>/cores/`
2. Pasta `<retroarch_exe_dir>/cores/`
3. Pasta `%APPDATA%\RetroArch\cores\`

Se nenhum núcleo compatível for encontrado, o sistema impede o lançamento e dispara um erro explicativo `CoreNotFoundError`.

---

## 5. Safe Auto-Discovery Engine

O `EmulatorDetectionService` realiza a detecção de emuladores instalados no sistema do usuário de maneira não invasiva:
- **Zero Full-Disk Scans:** Nunca realiza varredura recursiva em unidades inteiras (como `C:\` ou `D:\`).
- **Diretórios Padrão Monitorados:**
  - `%ProgramFiles%\<Emulator>`
  - `%ProgramFiles(x86)%\<Emulator>`
  - `%LOCALAPPDATA%\Programs\<Emulator>`
  - `%APPDATA%\<Emulator>`
  - `C:\Emulators\<Emulator>`
  - `D:\Emulators\<Emulator>`
- **Detecção de Versão:** Ao encontrar o executável, valida a acessibilidade e persiste o registro no banco de dados SQLite com flag `detected = 1`.

---

## 6. Portable Emulators & Custom Configurations

O Game Vault suporta emuladores portáteis sem instalação no sistema operacional:
1. **Configuração Manual via UI:** No painel de Configurações, o usuário pode clicar em **[ Browse... ]** em qualquer emulador e selecionar o executável em qualquer disco rígido, SSD externo ou pendrive.
2. **Diretório de Trabalho Preservado:** Se o executável estiver em uma pasta portátil contendo configurações locais (ex: `D:\PortableApps\PCSX2\`), o diretório de trabalho (`cwd`) é automaticamente fixado na pasta do emulador, garantindo que plugins, BIOS e memcards sejam carregados corretamente.
3. **Custom Arguments:** O usuário pode configurar argumentos adicionais por jogo (ex: `--fastboot`, `--render-resolution 2x`) através do modal de Detalhes do Jogo.
