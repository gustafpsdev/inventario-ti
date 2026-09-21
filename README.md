# Inventário e Gestão de Ativos de TI

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
