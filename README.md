# Inventário e Gestão de Ativos de TI

![Python](https://img.shields.io/badge/Python-3.11+-496B86?logo=python&logoColor=white) ![SQLite](https://img.shields.io/badge/SQLite-local-5B7185?logo=sqlite&logoColor=white) ![Status](https://img.shields.io/badge/status-portfólio-68717A)

Sistema web para centralizar o cadastro, a movimentação e a auditoria de ativos de TI.

## Recursos

- Cadastro e edição de computadores, impressoras, monitores e tablets
- Histórico de movimentações e responsáveis
- Controle de suprimentos e alertas de estoque
- Contas individuais e trilha de auditoria
- Exportação CSV e backups locais

## Tecnologias

Python, SQLite, JavaScript, HTML e CSS.

## Execução

```bash
export ADMIN_PASSWORD="uma-senha-forte"
python server.py
```

No Windows, defina `ADMIN_PASSWORD` antes de executar `start_windows.bat`. A aplicação estará disponível em `http://localhost:8086`.

> O repositório não contém dados, planilhas, marcas ou informações da implantação original. O banco SQLite é criado localmente na primeira execução.


## Arquitetura

```text
Navegador (HTML/CSS/JS)
        ↓ API HTTP
Servidor Python
        ↓
SQLite local + backups
```

O frontend consome a API do servidor Python. A aplicação mantém os ativos, usuários, movimentações e registros de auditoria em um banco SQLite criado localmente.

## Licença

Distribuído sob a licença MIT. Consulte o arquivo [LICENSE](LICENSE).
