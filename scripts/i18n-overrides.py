#!/usr/bin/env python3
"""
Apply hand-curated translation overrides for high-visibility UI terms
that MyMemory mistranslates (e.g. "Sinks" -> "Lavabos" in Spanish - it
means kitchen sinks, not data sinks).

Run this AFTER scripts/i18n-translate.py to fix the obvious clangers.
Adding more overrides: just extend OVERRIDES below - one map per language,
keys are dotted paths into the locale JSON.

Usage:
    python scripts/i18n-overrides.py
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LOCALES_DIR = ROOT / 'frontend' / 'src' / 'i18n' / 'locales'

# Hand-curated overrides per language. Keys are dotted paths inside the
# JSON. Only listed languages are touched; everything else keeps the
# machine translation.
OVERRIDES: dict[str, dict[str, str]] = {
    'es': {
        'palette.sources': 'Origenes',
        'palette.sinks': 'Destinos',
        'palette.transforms': 'Transformaciones',
        'palette.controlFlow': 'Control de flujo',
        'palette.dataQuality': 'Calidad de datos',
        'palette.customCode': 'Codigo personalizado',
        'palette.groups.files': 'Archivos',
        'palette.groups.databases': 'Bases de datos',
        'palette.groups.apis': 'APIs',
        'palette.groups.streaming': 'Streaming',
        'palette.groups.objectStorage': 'Almacenamiento de objetos',
        'palette.groups.cloudWarehouses': 'Data warehouses en la nube',
        'palette.groups.lakehouse': 'Formatos lakehouse',
        'palette.groups.nosqlSearch': 'NoSQL y busqueda',
        'palette.groups.other': 'Otro',
        'palette.groups.vectorAi': 'Bases vectoriales / IA',
        'palette.groups.fields': 'Campos',
        'palette.groups.rows': 'Filas',
        'palette.groups.aggregate': 'Agregar',
        'palette.groups.join': 'Unir',
        'palette.groups.setOps': 'Operaciones de conjuntos',
        'palette.groups.window': 'Ventana',
        'palette.groups.strings': 'Cadenas',
        'palette.groups.dateTime': 'Fecha / Hora',
        'palette.groups.numeric': 'Numerico',
        'palette.groups.validation': 'Validacion',
        'palette.groups.profiling': 'Perfilado',
        'palette.groups.cleansing': 'Limpieza',
        'palette.groups.sql': 'SQL',
        'palette.groups.scripting': 'Scripting',
        'palette.groups.routing': 'Enrutamiento',
        'palette.groups.timing': 'Temporizacion',
        'palette.groups.pipelines': 'Pipelines',
        'palette.groups.errorHandling': 'Manejo de errores',
        'editorTabs.canvas': 'Lienzo',
        'editorTabs.plan': 'Plan',
        'editorTabs.run': 'Ejecutar',
        'header.run': 'Ejecutar',
        'header.stop': 'Parar',
        'header.save': 'Guardar',
        'header.validate': 'Validar',
        'sidebar.project': 'Proyecto',
        'sidebar.components': 'Componentes',
        'status.pipelineLabel': 'Pipeline:',
        'status.engineLabel': 'Motor:',
        'status.runtimeLabel': 'Runtime:',
        'status.nodes': 'nodos',
        'status.edges': 'enlaces',
        'engine.label': 'Motor',
        'bottom.problems': 'Problemas',
        'bottom.output': 'Salida',
        'bottom.console': 'Consola',
        'properties.tabBasic': 'Basico',
        'properties.tabSchema': 'Esquema',
        'properties.tabPreview': 'Vista previa',
        'properties.tabAdvanced': 'Avanzado',
        'properties.tabValidation': 'Validacion',
        'common.save': 'Guardar',
        'common.cancel': 'Cancelar',
        'common.close': 'Cerrar',
        'common.delete': 'Eliminar',
        'common.confirm': 'Confirmar',
        'common.create': 'Crear',
        'common.ok': 'Aceptar',
    },
    'pt-BR': {
        'palette.sources': 'Fontes',
        'palette.sinks': 'Destinos',
        'palette.transforms': 'Transformacoes',
        'palette.controlFlow': 'Fluxo de controle',
        'palette.dataQuality': 'Qualidade de dados',
        'palette.customCode': 'Codigo personalizado',
        'editorTabs.canvas': 'Tela',
        'editorTabs.plan': 'Plano',
        'editorTabs.run': 'Executar',
        'header.run': 'Executar',
        'header.stop': 'Parar',
        'header.save': 'Salvar',
        'sidebar.project': 'Projeto',
        'sidebar.components': 'Componentes',
        'common.save': 'Salvar',
        'common.cancel': 'Cancelar',
        'common.close': 'Fechar',
    },
    'fr': {
        'palette.sources': 'Sources',
        'palette.sinks': 'Destinations',
        'palette.transforms': 'Transformations',
        'palette.controlFlow': 'Flux de controle',
        'palette.dataQuality': 'Qualite des donnees',
        'palette.customCode': 'Code personnalise',
        'editorTabs.canvas': 'Canevas',
        'editorTabs.plan': 'Plan',
        'editorTabs.run': 'Executer',
        'header.run': 'Executer',
        'header.stop': 'Arreter',
        'header.save': 'Enregistrer',
        'sidebar.project': 'Projet',
        'sidebar.components': 'Composants',
        'common.save': 'Enregistrer',
        'common.cancel': 'Annuler',
        'common.close': 'Fermer',
    },
    'de': {
        'palette.sources': 'Quellen',
        'palette.sinks': 'Senken',
        'palette.transforms': 'Transformationen',
        'palette.controlFlow': 'Steuerfluss',
        'palette.dataQuality': 'Datenqualitat',
        'palette.customCode': 'Eigener Code',
        'editorTabs.canvas': 'Leinwand',
        'editorTabs.plan': 'Plan',
        'editorTabs.run': 'Ausfuhren',
        'header.run': 'Ausfuhren',
        'header.stop': 'Stoppen',
        'header.save': 'Speichern',
        'sidebar.project': 'Projekt',
        'sidebar.components': 'Komponenten',
        'common.save': 'Speichern',
        'common.cancel': 'Abbrechen',
        'common.close': 'Schliessen',
    },
    'ja': {
        'palette.sources': 'ソース',
        'palette.sinks': 'シンク',
        'palette.transforms': '変換',
        'palette.controlFlow': '制御フロー',
        'palette.dataQuality': 'データ品質',
        'palette.customCode': 'カスタムコード',
        'editorTabs.canvas': 'キャンバス',
        'editorTabs.plan': 'プラン',
        'editorTabs.run': '実行',
        'header.run': '実行',
        'header.stop': '停止',
        'header.save': '保存',
        'sidebar.project': 'プロジェクト',
        'sidebar.components': 'コンポーネント',
        'common.save': '保存',
        'common.cancel': 'キャンセル',
        'common.close': '閉じる',
    },
    'zh-CN': {
        'palette.sources': '数据源',
        'palette.sinks': '输出',
        'palette.transforms': '转换',
        'palette.controlFlow': '控制流',
        'palette.dataQuality': '数据质量',
        'palette.customCode': '自定义代码',
        'editorTabs.canvas': '画布',
        'editorTabs.plan': '计划',
        'editorTabs.run': '运行',
        'header.run': '运行',
        'header.stop': '停止',
        'header.save': '保存',
        'sidebar.project': '项目',
        'sidebar.components': '组件',
        'common.save': '保存',
        'common.cancel': '取消',
        'common.close': '关闭',
    },
    'ko': {
        'palette.sources': '소스',
        'palette.sinks': '싱크',
        'palette.transforms': '변환',
        'palette.controlFlow': '제어 흐름',
        'palette.dataQuality': '데이터 품질',
        'palette.customCode': '사용자 정의 코드',
        'editorTabs.canvas': '캔버스',
        'editorTabs.plan': '플랜',
        'editorTabs.run': '실행',
        'header.run': '실행',
        'header.stop': '중지',
        'header.save': '저장',
        'sidebar.project': '프로젝트',
        'sidebar.components': '컴포넌트',
    },
    'it': {
        'palette.sources': 'Origini',
        'palette.sinks': 'Destinazioni',
        'palette.transforms': 'Trasformazioni',
        'palette.controlFlow': 'Flusso di controllo',
        'palette.dataQuality': 'Qualita dei dati',
        'palette.customCode': 'Codice personalizzato',
        'header.run': 'Esegui',
        'header.stop': 'Ferma',
        'header.save': 'Salva',
        'sidebar.project': 'Progetto',
        'sidebar.components': 'Componenti',
    },
    'ru': {
        'palette.sources': 'Источники',
        'palette.sinks': 'Назначения',
        'palette.transforms': 'Преобразования',
        'palette.controlFlow': 'Поток управления',
        'palette.dataQuality': 'Качество данных',
        'palette.customCode': 'Свой код',
        'header.run': 'Запуск',
        'header.stop': 'Стоп',
        'header.save': 'Сохранить',
        'sidebar.project': 'Проект',
        'sidebar.components': 'Компоненты',
    },
    'ar': {
        'palette.sources': 'المصادر',
        'palette.sinks': 'الوجهات',
        'palette.transforms': 'التحويلات',
        'palette.controlFlow': 'تدفق التحكم',
        'palette.dataQuality': 'جودة البيانات',
        'palette.customCode': 'كود مخصص',
        'header.run': 'تشغيل',
        'header.stop': 'إيقاف',
        'header.save': 'حفظ',
        'sidebar.project': 'مشروع',
        'sidebar.components': 'مكونات',
    },
    'hi': {
        'palette.sources': 'स्रोत',
        'palette.sinks': 'गंतव्य',
        'palette.transforms': 'रूपांतरण',
        'palette.controlFlow': 'नियंत्रण प्रवाह',
        'palette.dataQuality': 'डेटा गुणवत्ता',
        'palette.customCode': 'कस्टम कोड',
    },
}


def set_by_path(d: dict, dotted: str, value: str) -> None:
    parts = dotted.split('.')
    cur = d
    for p in parts[:-1]:
        cur = cur.setdefault(p, {})
    cur[parts[-1]] = value


def main():
    total = 0
    for lang, overrides in OVERRIDES.items():
        path = LOCALES_DIR / f'{lang}.json'
        if not path.exists():
            print(f'  skip {lang} (no JSON)')
            continue
        with path.open(encoding='utf-8') as f:
            data = json.load(f)
        for k, v in overrides.items():
            set_by_path(data, k, v)
            total += 1
        with path.open('w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
            f.write('\n')
        print(f'  patched {lang}: {len(overrides)} keys')
    print(f'Total overrides applied: {total}')


if __name__ == '__main__':
    main()
