# Milhas

App pessoal que procura os melhores resgates com milhas (**Smiles**, **LATAM Pass** e **Azul**)
nas rotas que você escolher. Funciona como app no iPhone (PWA) e custa **R$ 0**:

- **App:** site estático em `web/`, publicado no GitHub Pages.
- **Busca:** `python -m collector`, rodando no GitHub Actions (ou no seu computador).
- **Dados:** `web/data/results.json`, gerado pela busca e lido pelo app.
- **Alertas:** Telegram (próxima etapa).

```
config/config.json ──► collector (Smiles / LATAM / Azul) ──► web/data/results.json ──► app no iPhone
```

## Status

| Etapa | Situação |
|---|---|
| 1. App web + dados de exemplo | ✅ |
| 2. Coletor Smiles | ⏳ |
| 3. Alertas no Telegram | ⏳ |
| 4. Coletores Azul e LATAM Pass | ⏳ |

## O app

| Aba | O que faz |
|---|---|
| **Buscar** | Programa (ou todos), origem, destino (opcional: em branco = `popular_destinations`), ida e volta (opcional), data exata ou ± 2 dias. Mostra na hora o que já foi buscado, a melhor combinação ida + volta e, se faltar algo, pede ao robô. |
| **Monitoradas** | Resultados das rotas monitoradas. |
| **Calendário** | Escolha origem, destino, programa, cabine e mês: menor preço de cada dia (`–` sem vaga, `?` não buscado). Pode pedir ao robô o mês inteiro. |
| **Alertas** | Cadastre/remova rotas monitoradas com o valor-limite do alerta (milhas ou R$). |
| **Ajustes** | Chave do GitHub e valor do milheiro. |

Os pedidos do app chegam ao robô pelo workflow *Buscar resgates* (input `command`, JSON validado pelo
coletor). Para isso o app precisa de uma chave do GitHub (fine-grained token só deste repositório, com
permissão **Actions: Read and write**), cadastrada uma vez em **Ajustes**; ela fica só no aparelho.
As rotas monitoradas criadas no app ficam em `data/monitors.json`.

## Busca aos poucos

Para não ser bloqueado, cada rodada faz só um lote de buscas (programa × trecho × data) e guarda
o progresso em `data/state.json`. Quando todas as datas de todas as rotas forem buscadas, a
**varredura fica completa** e o app mostra o ranking final; em seguida começa outra varredura para
manter os preços atualizados. O tamanho do lote e a pausa entre buscas ficam em `pacing`, no config.

## Configuração (`config/config.json`)

- `milheiro_brl`: quanto valem 1.000 milhas de cada programa (custo = milhas ÷ 1000 × milheiro + taxas).
- `pacing`: buscas por rodada e pausa entre buscas, por fonte.
- `airport_groups`: atalhos de aeroportos (ex.: `SAO` = GRU + VCP).
- `popular_destinations`: destinos usados quando o destino fica em branco.
- `routes`: rotas monitoradas fixas (opcional — o normal é criá-las pelo app).

## Publicar o app (uma vez só)

1. Deixe o repositório **público** (Settings → General → Danger Zone → Change visibility).
2. Settings → **Pages** → Source: **GitHub Actions**.
3. Actions → **Publicar app (GitHub Pages)** → Run workflow.
4. Abra `https://flavioronchi.github.io/Milhas-/` no Safari do iPhone →
   **Compartilhar → Adicionar à Tela de Início**.

## Rodar localmente

```bash
python -m collector               # gera web/data/results.json
python -m http.server -d web 8000 # abra http://localhost:8000
python scripts/make_icons.py      # (re)gera os ícones
```

## Avisos

Preços são por pessoa, só ida, e mudam rápido: confirme sempre no site do programa antes de emitir.
Consultas automatizadas podem violar os termos de uso dos programas; o coletor faz poucas buscas,
só para uso pessoal.
