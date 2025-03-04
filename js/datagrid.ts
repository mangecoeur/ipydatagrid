// Copyright (c) Bloomberg
// Distributed under the terms of the Modified BSD License.

import * as _ from 'underscore';

import { BasicSelectionModel, TextRenderer } from '@lumino/datagrid';

import { CellRenderer } from '@lumino/datagrid';

import { JSONExt } from '@lumino/coreutils';

import { Message, MessageLoop } from '@lumino/messaging';

import { Widget } from '@lumino/widgets';

import {
  DOMWidgetModel,
  DOMWidgetView,
  ICallbacks,
  ISerializers,
  JupyterLuminoPanelWidget,
  //@ts-ignore needed for ipywidgetx 7.x compatibility
  JupyterPhosphorPanelWidget,
  resolvePromisesDict,
  unpack_models,
  WidgetModel
} from '@jupyter-widgets/base';

import { ViewBasedJSONModel } from './core/viewbasedjsonmodel';

import { MODULE_NAME, MODULE_VERSION } from './version';

import { CellRendererModel, CellRendererView } from './cellrenderer';
import { FeatherGrid } from './feathergrid';
import { Theme } from './utils';

// Import CSS
import '../style/jupyter-widget.css';

// Shorthand for a string->T mapping
type Dict<T> = { [keys: string]: T };

export class DataGridModel extends DOMWidgetModel {
  defaults() {
    return {
      ...super.defaults(),
      _model_module: DataGridModel.model_module,
      _model_module_version: DataGridModel.model_module_version,
      _view_name: DataGridModel.view_name,
      _view_module: DataGridModel.view_module,
      _view_module_version: DataGridModel.view_module_version,
      _visible_rows: [],
      _transforms: [],
      baseRowSize: 20,
      baseColumnSize: 64,
      baseRowHeaderSize: 64,
      baseColumnHeaderSize: 20,
      headerVisibility: 'all',
      _data: {},
      renderers: {},
      corner_renderer: null,
      default_renderer: null,
      header_renderer: null,
      selection_mode: 'none',
      selections: [],
      grid_style: {},
      editable: false,
      column_widths: {},
    };
  }

  initialize(attributes: any, options: any) {
    super.initialize(attributes, options);

    this.updateDataSync = this.updateDataSync.bind(this);
    this.syncTransformState = this.syncTransformState.bind(this);

    this.on('change:_data', this.updateData.bind(this));
    this.on('change:_transforms', this.updateTransforms.bind(this));
    this.on('change:selection_mode', this.updateSelectionModel, this);
    this.on('change:selections', this.updateSelections, this);
    this.updateData();
    this.updateTransforms();
    this.updateSelectionModel();

    this.on('msg:custom', (content) => {
      if (content.event_type === 'cell-changed') {
        this.data_model.setModelData(
          'body',
          content.row,
          content.column_index,
          content.value,
        );
      }
    });
  }

  updateDataSync(sender: any, msg: any) {
    switch (msg.type) {
      case 'row-indices-updated':
        this.set('_visible_rows', msg.indices);
        this.save_changes();
        break;
      case 'cell-updated':
        this.set('_data', this.data_model.dataset);
        this.save_changes();
        break;
      case 'cell-edit-event':
        // Update data in widget model
        const newData = this.get('_data');
        newData.data[msg.row][msg.columnIndex] = msg.value;
        this.set('_data', newData);

        this.send(
          {
            event_type: 'cell-changed',
            region: msg.region,
            row: msg.row,
            column_index: msg.columnIndex,
            value: msg.value,
          },
          { ...this._view_callbacks },
        );
        break;
      default:
        throw 'unreachable';
    }
  }

  syncTransformState(sender: any, value: any) {
    this.set('_transforms', value.transforms);
    this.save_changes();
  }

  updateData() {
    const data = this.data;
    const schema = Private.createSchema(data);

    if (this.data_model) {
      this.data_model.updateDataset({ data: data.data, schema: schema });
      this.data_model.transformStateChanged.disconnect(this.syncTransformState);
      this.data_model.dataSync.disconnect(this.updateDataSync);
    }

    this.data_model = new ViewBasedJSONModel({
      data: data.data,
      schema: schema,
    });

    this.data_model.transformStateChanged.connect(this.syncTransformState);
    this.data_model.dataSync.connect(this.updateDataSync);

    this.updateTransforms();
    this.trigger('data-model-changed');
    this.updateSelectionModel();
  }

  updateTransforms() {
    if (this.selectionModel) {
      this.selectionModel.clear();
    }
    this.data_model.replaceTransforms(this.get('_transforms'));
  }

  updateSelectionModel() {
    if (this.selectionModel) {
      this.selectionModel.clear();
    }

    const selectionMode = this.get('selection_mode');

    if (selectionMode === 'none') {
      this.selectionModel = null;
      return;
    }

    this.selectionModel = new BasicSelectionModel({
      dataModel: this.data_model,
    });
    this.selectionModel.selectionMode = selectionMode;
    this.trigger('selection-model-changed');

    this.selectionModel.changed.connect(
      (sender: BasicSelectionModel, args: void) => {
        if (this.synchingWithKernel) {
          return;
        }

        this.synchingWithKernel = true;

        const selectionIter = sender.selections().iter();
        const selections: any[] = [];
        let selection = null;
        while ((selection = selectionIter.next())) {
          selections.push({
            r1: Math.min(selection.r1, selection.r2),
            r2: Math.max(selection.r1, selection.r2),
            c1: Math.min(selection.c1, selection.c2),
            c2: Math.max(selection.c1, selection.c2),
          });
        }

        this.set('selections', selections);
        this.save_changes();

        this.synchingWithKernel = false;
      },
      this,
    );
  }

  updateSelections() {
    if (!this.selectionModel || this.synchingWithKernel) {
      return;
    }

    this.synchingWithKernel = true;

    const selections = this.get('selections');
    this.selectionModel.clear();

    for (const selection of selections) {
      this.selectionModel.select({
        r1: selection.r1,
        c1: selection.c1,
        r2: selection.r2,
        c2: selection.c2,
        cursorRow: selection.r1,
        cursorColumn: selection.c1,
        clear: 'none',
      });
    }

    this.synchingWithKernel = false;
  }

  get data(): DataGridModel.IData {
    return this.get('_data');
  }

  static serializers: ISerializers = {
    ...DOMWidgetModel.serializers,
    transforms: { deserialize: unpack_models as any },
    renderers: { deserialize: unpack_models as any },
    corner_renderer: { deserialize: unpack_models as any },
    default_renderer: { deserialize: unpack_models as any },
    header_renderer: { deserialize: unpack_models as any },
    _data: { deserialize: unpack_data as any },
    grid_style: { deserialize: unpack_style as any },
  };

  static model_name = 'DataGridModel';
  static model_module = MODULE_NAME;
  static model_module_version = MODULE_VERSION;

  static view_name = 'DataGridView';
  static view_module = MODULE_NAME;
  static view_module_version = MODULE_VERSION;

  data_model: ViewBasedJSONModel;
  selectionModel: BasicSelectionModel | null;
  synchingWithKernel = false;
  _view_callbacks: ICallbacks;
}

/**
 * Helper function to conver snake_case strings to camelCase.
 * Assumes all strings are valid snake_case (all lowercase).
 * @param string snake_case string
 * @returns camelCase string
 */
function camelCase(string: string): string {
  string = string.toLowerCase();
  const charArray = [];
  for (let i = 0; i < string.length; i++) {
    const curChar = string.charAt(i);
    if (curChar === '_') {
      i++;
      charArray.push(string.charAt(i).toUpperCase());
      continue;
    }
    charArray.push(curChar);
  }

  return charArray.join('');
}

/**
 * Custom deserialization function for grid styles.
 */
function unpack_style(
  value: any | Dict<unknown> | string | (Dict<unknown> | string)[],
  manager: any,
): Promise<WidgetModel | Dict<WidgetModel> | WidgetModel[] | any> {
  if (value instanceof Object && typeof value !== 'string') {
    const unpacked: { [key: string]: any } = {};
    Object.keys(value).forEach((key) => {
      unpacked[camelCase(key)] = unpack_style(value[key], manager);
    });
    return resolvePromisesDict(unpacked);
  } else if (typeof value === 'string' && value.slice(0, 10) === 'IPY_MODEL_') {
    return Promise.resolve(
      manager.get_model(value.slice(10, value.length)),
    ).then((model) => {
      // returning the color formatting function from VegaExprModel.
      return model._function;
    });
  } else {
    return Promise.resolve(value);
  }
}

// modified from ipywidgets original
function unpack_data(
  value: any | Dict<unknown> | string | (Dict<unknown> | string)[],
  manager: any,
): Promise<WidgetModel | Dict<WidgetModel> | WidgetModel[] | any> {
  if (Array.isArray(value)) {
    const unpacked: any[] = [];
    value.forEach((sub_value, key) => {
      unpacked.push(unpack_data(sub_value, manager));
    });
    return Promise.all(unpacked);
  } else if (value instanceof Object && typeof value !== 'string') {
    const unpacked: { [key: string]: any } = {};
    Object.keys(value).forEach((key) => {
      unpacked[key] = unpack_data(value[key], manager);
    });
    return resolvePromisesDict(unpacked);
  } else if (value === '$NaN$') {
    return Promise.resolve(Number.NaN);
  } else if (value === '$Infinity$') {
    return Promise.resolve(Number.POSITIVE_INFINITY);
  } else if (value === '$NegInfinity$') {
    return Promise.resolve(Number.NEGATIVE_INFINITY);
  } else if (value === '$NaT$') {
    return Promise.resolve(new Date('INVALID'));
  } else {
    return Promise.resolve(value);
  }
}

export class DataGridView extends DOMWidgetView {
  _createElement(tagName: string) {
    const panelWidget = Private.getWidgetPanel();
    this.luminoWidget = new panelWidget({ view: this });
    this._initializeTheme();
    return this.luminoWidget.node;
  }

  // Added for ipywidgets 7.x compatibility
  get pWidget(): any {
    return this.luminoWidget;
  }

  _setElement(el: HTMLElement) {
    if (this.el || el !== this.luminoWidget.node) {
      throw new Error('Cannot reset the DOM element.');
    }

    this.el = this.luminoWidget.node;
  }

  manageResizeEvent = () => {
    MessageLoop.postMessage(
      this.luminoWidget,
      Widget.ResizeMessage.UnknownSize,
    );
  };

  // ipywidgets 7 compatibility
  _processLuminoMessage(
    msg: Message,
    _super: DOMWidgetView['processLuminoMessage'],
  ): void {
    _super.call(this, msg);

    switch (msg.type) {
      case 'after-show':
        if (this.luminoWidget.isVisible) {
          this.manageResizeEvent();
        }
        break;
    }
  }

  processLuminoMessage(msg: Message): void {
    this._processLuminoMessage(msg, super.processLuminoMessage);
  }

  processPhosphorMessage(msg: Message): void {
    //@ts-ignore needed for ipywidgets 7.x compatibility
    this._processLuminoMessage(msg, super.processPhosphorMessage);
  }

  render(): Promise<void> {
    this.el.classList.add('datagrid-container');
    window.addEventListener('resize', this.manageResizeEvent);
    this.once('remove', () => {
      window.removeEventListener('resize', this.manageResizeEvent);
    });

    this.grid = new FeatherGrid({
      defaultSizes: {
        rowHeight: this.model.get('base_row_size'),
        columnWidth: this.model.get('base_column_size'),
        rowHeaderWidth: this.model.get('base_row_header_size'),
        columnHeaderHeight: this.model.get('base_column_header_size'),
      },
      headerVisibility: this.model.get('header_visibility'),
      style: this.model.get('grid_style'),
    });

    this.grid.columnWidths = this.model.get('column_widths');
    this.grid.editable = this.model.get('editable');
    // this.default_renderer must be created after setting grid.isLightTheme
    // for proper color variable initialization
    this.grid.isLightTheme = this._isLightTheme;
    this.grid.dataModel = this.model.data_model;
    this.grid.selectionModel = this.model.selectionModel;
    this.grid.backboneModel = this.model;

    this.grid.cellClicked.connect(
      (sender: FeatherGrid, event: FeatherGrid.ICellClickedEvent) => {
        if (this.model.comm) {
          this.send({
            event_type: 'cell-click',
            region: event.region,
            column: event.column,
            column_index: event.columnIndex,
            row: event.row,
            primary_key_row: event.primaryKeyRow,
            cell_value: event.cellValue,
          });
        }
      },
    );

    this.grid.columnsResized.connect(
      (sender: FeatherGrid, args: void): void => {
        this.model.set(
          'column_widths',
          JSONExt.deepCopy(this.grid.columnWidths),
        );
        this.model.save_changes();
      },
    );

    // Attaching the view's iopub callbacks functions to
    // the data model so we can use those as an
    // argument to model.send() function in the model class.
    this.model._view_callbacks = this.callbacks();

    this.model.on('data-model-changed', () => {
      this.grid.dataModel = this.model.data_model;
    });

    this.model.on('change:base_row_size', () => {
      this.grid.baseRowSize = this.model.get('base_row_size');
    });

    this.model.on('change:base_column_size', () => {
      this.grid.baseColumnSize = this.model.get('base_column_size');
    });

    this.model.on('change:column_widths', () => {
      this.grid.columnWidths = this.model.get('column_widths');
    });

    this.model.on('change:base_row_header_size', () => {
      this.grid.baseRowHeaderSize = this.model.get('base_row_header_size');
    });

    this.model.on('change:base_column_header_size', () => {
      this.grid.baseColumnHeaderSize = this.model.get(
        'base_column_header_size',
      );
    });

    this.model.on('change:header_visibility', () => {
      this.grid.headerVisibility = this.model.get('header_visibility');
    });

    this.model.on_some_change(
      [
        'corner_renderer',
        'header_renderer',
        'default_renderer',
        'renderers',
        'grid_style',
      ],
      () => {
        this.updateRenderers()
          .then(this.updateGridStyle.bind(this))
          .then(this.updateGridRenderers.bind(this));
      },
      this,
    );

    this.model.on('selection-model-changed', () => {
      this.grid.selectionModel = this.model.selectionModel;
    });

    this.model.on('change:editable', () => {
      this.grid.editable = this.model.get('editable');
    });

    this.model.on_some_change(
      ['auto_fit_columns', 'auto_fit_params'],
      () => {
        this.handleColumnAutoFit();
      },
      this,
    );

    if (this.model.get('auto_fit_columns')) {
      this.handleColumnAutoFit();
    }

    return this.updateRenderers().then(() => {
      this.updateGridStyle();
      this.updateGridRenderers();
      this.luminoWidget.addWidget(this.grid);
    });
  }

  private handleColumnAutoFit() {
    // Check whether we need to auto-fit or revert to base size.
    const shouldAutoFit = this.model.get('auto_fit_columns');
    if (!shouldAutoFit) {
      this.grid.baseColumnSize = this.model.get('base_column_size');
      // Terminate call here if not auto-fitting.
      return;
    }

    // Retrieve user-defined auto-fit params
    let { area, padding, numCols } = this.model.get('auto_fit_params');

    // Data validation on params
    area = area ?? 'all';
    padding = padding ?? 30;
    numCols = numCols ?? undefined;

    // Call resize function
    this.grid.grid.fitColumnNames(area, padding, numCols);
  }

  private updateRenderers() {
    // Unlisten to previous renderers
    if (this.default_renderer) {
      this.stopListening(this.default_renderer, 'renderer-changed');
    }
    if (this.header_renderer) {
      this.stopListening(this.header_renderer, 'renderer-changed');
    }
    if (this.corner_renderer) {
      this.stopListening(this.corner_renderer, 'renderer-changed');
    }
    for (const key in this.renderers) {
      this.stopListening(this.renderers[key], 'renderer-changed');
    }

    // And create views for new renderers
    const promises = [];

    const default_renderer = this.model.get('default_renderer');
    promises.push(
      this.create_child_view(default_renderer).then(
        (defaultRendererView: any) => {
          this.default_renderer = defaultRendererView;

          this.listenTo(
            this.default_renderer,
            'renderer-changed',
            this.updateGridRenderers.bind(this),
          );
        },
      ),
    );

    const corner_renderer = this.model.get('corner_renderer');
    if (corner_renderer) {
      promises.push(
        this.create_child_view(corner_renderer).then(
          (cornerRendererView: any) => {
            this.corner_renderer = cornerRendererView;

            this.listenTo(
              this.corner_renderer,
              'renderer-changed',
              this.updateGridRenderers.bind(this),
            );
          },
        ),
      );
    }

    const header_renderer = this.model.get('header_renderer');
    if (header_renderer) {
      promises.push(
        this.create_child_view(header_renderer).then(
          (headerRendererView: any) => {
            this.header_renderer = headerRendererView;

            this.listenTo(
              this.header_renderer,
              'renderer-changed',
              this.updateGridRenderers.bind(this),
            );
          },
        ),
      );
    }

    const renderer_promises: Dict<Promise<any>> = {};
    _.each(
      this.model.get('renderers'),
      (model: CellRendererModel, key: string) => {
        renderer_promises[key] = this.create_child_view(model);
      },
    );
    promises.push(
      resolvePromisesDict(renderer_promises).then(
        (rendererViews: Dict<CellRendererView>) => {
          this.renderers = rendererViews;

          for (const key in rendererViews) {
            this.listenTo(
              rendererViews[key],
              'renderer-changed',
              this.updateGridRenderers.bind(this),
            );
          }
        },
      ),
    );

    return Promise.all(promises);
  }

  public updateGridStyle() {
    this.grid.updateGridStyle();
  }

  set isLightTheme(value: boolean) {
    this._isLightTheme = value;
    if (!this.grid) {
      return;
    }
    this.grid.isLightTheme = value;
  }

  get isLightTheme(): boolean {
    return this._isLightTheme;
  }

  private updateGridRenderers() {
    let defaultRenderer = this.default_renderer.renderer;
    if (
      this.grid.grid.style.backgroundColor !== Theme.getBackgroundColor() ||
      this.grid.grid.style.rowBackgroundColor ||
      this.grid.grid.style.columnBackgroundColor
    ) {
      // Making sure the default renderer doesn't paint over the global
      // grid background color, if the latter is set.
      defaultRenderer = new TextRenderer({
        ...this.default_renderer.renderer,
        backgroundColor: undefined,
      });
    }

    const hasHeaderRenderer = this.model.get('header_renderer') !== null;
    let columnHeaderRenderer = null;
    if (this.header_renderer && hasHeaderRenderer) {
      columnHeaderRenderer = this.header_renderer.renderer;
    } else {
      columnHeaderRenderer = new TextRenderer({
        font: '12px sans-serif',
        textColor: Theme.getFontColor(),
        backgroundColor: Theme.getBackgroundColor(2),
      });
    }

    let cornerHeaderRenderer = null;
    if (this.corner_renderer) {
      cornerHeaderRenderer = this.corner_renderer.renderer;
    }

    const renderers: Dict<CellRenderer> = {};
    Object.entries(this.renderers).forEach(([name, rendererView]) => {
      renderers[name] = rendererView.renderer;
    });

    this.grid.defaultRenderer = defaultRenderer;
    this.grid.columnHeaderRenderer = columnHeaderRenderer;

    if (cornerHeaderRenderer) {
      this.grid.cornerHeaderRenderer = cornerHeaderRenderer;
    }
    this.grid.renderers = renderers;
  }

  private _initializeTheme() {
    // initialize theme unless set earlier
    if (this._isLightTheme !== undefined) {
      return;
    }

    // initialize theme based on application settings
    this._isLightTheme = !(
      (
        document.body.classList.contains(
          'theme-dark',
        ) /* jupyter notebook or voila */ ||
        document.body.dataset.jpThemeLight === 'false'
      ) /* jupyter lab */
    );
  }

  renderers: Dict<CellRendererView>;
  corner_renderer: CellRendererView;
  default_renderer: CellRendererView;
  header_renderer: CellRendererView;
  grid: FeatherGrid;
  luminoWidget: JupyterLuminoPanelWidget;
  model: DataGridModel;
  backboneModel: DataGridModel;

  // keep undefined since widget initializes before constructor
  private _isLightTheme: boolean;
}

export {
  BarRendererModel,
  BarRendererView,
  HyperlinkRendererModel,
  HyperlinkRendererView, TextRendererModel,
  TextRendererView
} from './cellrenderer';
export { VegaExprModel, VegaExprView } from './vegaexpr';


export namespace DataGridModel {
  /**
   * An options object for initializing the data model.
   */
  export interface IData {
    data: ViewBasedJSONModel.DataSource;
    schema: ISchema;
    fields: { [key: string]: null }[];
  }
  export interface IField {
    readonly name: string | any[];
    readonly type: string;
    readonly rows: any[];
  }
  export interface ISchema {
    readonly fields: IField[];
    readonly primaryKey: string[];
    readonly primaryKeyUuid: string;
  }
}

/**
 * The namespace for the module implementation details.
 */
namespace Private {
  export function getWidgetPanel(): any {
    //@ts-ignore needed for ipywidget 7.x compatibility
    return JupyterLuminoPanelWidget ?? JupyterPhosphorPanelWidget;
  }


  /**
   * Creates a valid JSON Table Schema from the schema provided by pandas.
   *
   * @param data - The data that has been synced from the kernel.
   */
  export function createSchema(
    data: DataGridModel.IData,
  ): ViewBasedJSONModel.ISchema {
    // Construct a new array of schema fields based on the keys in data.fields
    // Note: this accounts for how tuples/lists may be serialized into strings
    // in the case of multiIndex columns.
    const fields: ViewBasedJSONModel.IField[] = [];
    data.fields.forEach((val: { [key: string]: null }, i: number) => {
      const rows = Array.isArray(data.schema.fields[i].name)
        ? <any[]>data.schema.fields[i].name
        : <string[]>[data.schema.fields[i].name];
      const field = {
        name: Object.keys(val)[0],
        type: data.schema.fields[i].type,
        rows: rows,
      };
      fields.push(field);
    });

    // Updating the primary key to account for a multiIndex primary key.
    const primaryKey = data.schema.primaryKey.map((key: string) => {
      for (let i = 0; i < data.schema.fields.length; i++) {
        const curFieldKey = Array.isArray(key)
          ? data.schema.fields[i].name[0]
          : data.schema.fields[i].name;
        const newKey = Array.isArray(key) ? key[0] : key;

        if (curFieldKey == newKey) {
          return Object.keys(data.fields[i])[0];
        }
      }
      return 'unreachable';
    });

    return {
      primaryKey: primaryKey,
      primaryKeyUuid: data.schema.primaryKeyUuid,
      fields: fields,
    };
  }
}
