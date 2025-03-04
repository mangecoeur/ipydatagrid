import { PanelLayout, Widget } from '@lumino/widgets';
import { Message, IMessageHandler, MessageLoop } from '@lumino/messaging';
import {
  BasicMouseHandler,
  TextRenderer,
  DataModel,
  BasicSelectionModel,
  CellRenderer,
  RendererMap,
  Private,
  HyperlinkRenderer,
} from '@lumino/datagrid';
import { CommandRegistry } from '@lumino/commands';
import { toArray } from '@lumino/algorithm';
import { Signal, ISignal } from '@lumino/signaling';
import { DataGrid } from '@lumino/datagrid';
import { HeaderRenderer } from './core/headerRenderer';
import { InteractiveFilterDialog } from './core/filterMenu';
import { FeatherGridContextMenu } from './core/gridContextMenu';
import { ViewBasedJSONModel } from './core/viewbasedjsonmodel';
import { Transform } from './core/transform';
import { Theme } from './utils';
import { KeyHandler } from './keyhandler';

import { DataGridModel as BackBoneModel } from './datagrid';

import '@lumino/default-theme/style/datagrid.css';
import '../style/feathergrid.css';
import { Platform } from '@lumino/domutils';

// Shorthand for a string->T mapping
type Dict<T> = { [keys: string]: T };

/*
 This type has some of the properties of the ResizeColumnRequest Message which
 is what is being intercepted in the Message Hook. Because the original Message
 is in a Private namespace and we cannot access it, we are using this type.
 */
type FeatherGridColumnResizeMessage = {
  region: DataModel.ColumnRegion;
  index: number;
  size: number;
};

// var name: [light theme value, dark theme value]
const themeVariables: Map<string, string[]> = new Map([
  [
    '--ipydatagrid-filter-icon',
    [
      'var(--ipydatagrid-filter-icon-light)',
      'var(--ipydatagrid-filter-icon-dark)',
    ],
  ],
  [
    '--ipydatagrid-sort-asc-icon',
    [
      'var(--ipydatagrid-sort-asc-icon-light)',
      'var(--ipydatagrid-sort-asc-icon-dark)',
    ],
  ],
  [
    '--ipydatagrid-sort-desc-icon',
    [
      'var(--ipydatagrid-sort-desc-icon-light)',
      'var(--ipydatagrid-sort-desc-icon-dark)',
    ],
  ],

  ['--ipydatagrid-layout-color0', ['white', '#111111']],
  ['--ipydatagrid-layout-color1', ['white', '#212121']],
  ['--ipydatagrid-layout-color2', ['#eeeeee', '#424242']],
  ['--ipydatagrid-layout-color3', ['#bdbdbd', '#616161']],
  ['--ipydatagrid-layout-color4', ['#757575', '#757575']],

  [
    '--ipydatagrid-ui-font-color0',
    ['rgba(0, 0, 0, 1)', 'rgba(255, 255, 255, 1)'],
  ],
  [
    '--ipydatagrid-ui-font-color1',
    ['rgba(0, 0, 0, 0.87)', 'rgba(255, 255, 255, 0.87)'],
  ],
  [
    '--ipydatagrid-ui-font-color2',
    ['rgba(0, 0, 0, 0.54)', 'rgba(255, 255, 255, 0.54)'],
  ],
  [
    '--ipydatagrid-ui-font-color3',
    ['rgba(0, 0, 0, 0.38)', 'rgba(255, 255, 255, 0.38)'],
  ],

  ['--ipydatagrid-border-color0', ['#bdbdbd', '#616161']],
  ['--ipydatagrid-border-color1', ['#bdbdbd', '#616161']],
  ['--ipydatagrid-border-color2', ['#e0e0e0', '#424242']],
  ['--ipydatagrid-border-color3', ['#eeeeee', '#212121']],

  ['--ipydatagrid-brand-color0', ['#1976d2', '#1976d2']],
  ['--ipydatagrid-brand-color1', ['#2196f3', '#2196f3']],
  ['--ipydatagrid-brand-color2', ['#64b5f6', '#64b5f6']],
  ['--ipydatagrid-brand-color3', ['#bbdefb', '#bbdefb']],
  ['--ipydatagrid-brand-color4', ['#e3f2fd', '#e3f2fd']],
  ['--ipydatagrid-brand-color5', ['#00e6ff', '#00e6ff']],
  ['--ipydatagrid-brand-color6', ['#ffe100', '#ffe100']],
  ['--ipydatagrid-brand-color7', ['#009eb0', '#009eb0']],
  ['--ipydatagrid-brand-color8', ['#b09b00', '#b09b00']],

  ['--ipydatagrid-menu-bgcolor', ['white', 'black']],
  ['--ipydatagrid-menu-border-color', ['#bdbdbd', '#616161']],
  ['--ipydatagrid-filter-dlg-textcolor', ['black', 'white']],
  ['--ipydatagrid-filter-dlg-bgcolor', ['white', 'black']],
]);

class FeatherGridMouseHandler extends BasicMouseHandler {
  /**
   * Construct a new datagrid mouse handler.
   *
   * @param grid - The FeatherGrid object for which mouse events are handled.
   */
  constructor(grid: FeatherGrid) {
    super();

    this._grid = grid;
  }

  /**
   * Handle the mouse down event for the data grid.
   *
   * @param grid - The data grid of interest.
   *
   * @param event - The mouse down event of interest.
   */
  onMouseDown(grid: DataGrid, event: MouseEvent): void {
    const hit = grid.hitTest(event.clientX, event.clientY);
    const hitRegion = hit.region;
    const buttonSize = HeaderRenderer.iconWidth * 1.5;
    const buttonPadding = HeaderRenderer.buttonPadding;
    const accel = Platform.accelKey(event);

    this._mouseIsDown = true;

    // Send cell clicked signal
    if (hit.region !== 'void') {
      this._cellClicked.emit(hit);
    }

    if (hitRegion === 'corner-header' || hitRegion === 'column-header') {
      const columnWidth = grid.columnSize(
        hitRegion === 'corner-header' ? 'row-header' : 'body',
        hit.column,
      );
      const rowHeight = grid.rowSize('column-header', hit.row);

      const isMenuRow =
        (hit.region === 'column-header' &&
          hit.row ==
          this._grid.grid.dataModel!.rowCount('column-header') - 1) ||
        (hit.region === 'corner-header' && hit.row === 0);

      const isMenuClick =
        hit.x > columnWidth - buttonSize - buttonPadding &&
        hit.x < columnWidth - buttonPadding &&
        hit.y > rowHeight - buttonSize - buttonPadding &&
        hit.y < rowHeight - buttonPadding &&
        isMenuRow;

      if (isMenuClick) {
        this._grid.contextMenu.open(grid, {
          ...hit,
          x: event.clientX + window.scrollX,
          y: event.clientY + window.scrollY,
        });
        return;
      }
    }
    if (grid) {
      // Create cell config object.
      const config = Private.createCellConfigObject(grid, hit);

      // Bail if no cell config object is defined for the region.
      if (!config) {
        return;
      }

      // Retrieve cell renderer.
      const renderer = grid.cellRenderers.get(config!);

      // Only process hyperlink renderers.
      if (renderer instanceof HyperlinkRenderer) {
        // Use the url param if it exists.
        let url = CellRenderer.resolveOption(renderer.url, config!);
        // Otherwise assume cell value is the URL.
        if (!url) {
          const format = TextRenderer.formatGeneric();
          url = format(config!);
        }

        // Emit message to open the hyperlink only if user hit Ctrl+Click.
        if (accel) {
          // Emit event that will be caught in case window.open is blocked
          window.postMessage(
            {
              id: 'ipydatagrid::hyperlinkclick',
              url,
            },
            '*',
          );
          // Reset cursor default after clicking
          const cursor = this.cursorForHandle('none');
          grid.viewport.node.style.cursor = cursor;
        }
      }
    }
    super.onMouseDown(grid, event);
  }

  onMouseUp(grid: DataGrid, event: MouseEvent): void {
    this._mouseIsDown = false;
    super.onMouseUp(grid, event);
  }

  get mouseIsDown(): boolean {
    return this._mouseIsDown;
  }

  get isResizing(): boolean {
    return (
      this.pressData !== null &&
      (this.pressData.type == 'column-resize' ||
        this.pressData.type == 'row-resize')
    );
  }

  /**
   * A signal emitted when a grid cell is clicked.
   */
  get cellClicked(): ISignal<this, DataGrid.HitTestResult> {
    return this._cellClicked;
  }

  private _grid: FeatherGrid;
  private _mouseIsDown = false;
  private _cellClicked = new Signal<this, DataGrid.HitTestResult>(this);
}

export class FeatherGrid extends Widget {
  constructor(options: DataGrid.IOptions = {}) {
    super();
    this.addClass('ipydatagrid-widget');

    if (options.defaultSizes) {
      this._baseRowSize = options.defaultSizes.rowHeight || this._baseRowSize;
      this._baseColumnSize =
        options.defaultSizes.columnWidth || this._baseColumnSize;
      this._baseRowHeaderSize =
        options.defaultSizes.rowHeaderWidth || this._baseRowHeaderSize;
      this._baseColumnHeaderSize =
        options.defaultSizes.columnHeaderHeight || this._baseColumnHeaderSize;
    }
    this._headerVisibility = options.headerVisibility || this._headerVisibility;

    this._createGrid(options);

    this._defaultRenderer = new TextRenderer({
      font: '12px sans-serif',
      textColor: Theme.getFontColor(),
      backgroundColor:
        this.grid.style.backgroundColor || Theme.getBackgroundColor(),
      horizontalAlignment: 'center',
      verticalAlignment: 'center',
    });

    this._rowHeaderRenderer = new TextRenderer({
      textColor: Theme.getFontColor(1),
      backgroundColor:
        this.grid.style.headerBackgroundColor || Theme.getBackgroundColor(2),
      horizontalAlignment: 'center',
      verticalAlignment: 'center',
    });

    const layout = (this.layout = new PanelLayout());
    layout.addWidget(this.grid);
  }

  /**
   * Intercepts the column-resize-request message sent to a message handler
   * and updates the data model to have the correct column widths
   *
   * @param handler - The target handler of the message.
   *
   * @param msg - The message to be sent to the handler.
   *
   * @returns `true` if the message should continue to be processed
   *   as normal, or `false` if processing should cease immediately.
   */
  messageHook(handler: IMessageHandler, msg: Message): boolean {
    if (handler === this.grid.viewport) {
      const mouseHandler = this.grid
        .mouseHandler as unknown as FeatherGridMouseHandler;

      if (msg.type === 'column-resize-request' && mouseHandler.mouseIsDown) {
        const resizeMsg = msg as unknown as FeatherGridColumnResizeMessage;
        const columnName: string = this.dataModel.columnIndexToName(
          resizeMsg.index,
          resizeMsg.region,
        );
        this._columnWidths[columnName] = resizeMsg.size;
        this._columnsResized.emit();
        return true;
      }
    }
    return true;
  }

  set dataModel(model: ViewBasedJSONModel) {
    this._dataModel = model;

    if (!this.grid) {
      return;
    }

    this.grid.dataModel = this._dataModel;
    this._updateHeaderRenderer();
    this._filterDialog.model = this._dataModel;
    this._updateColumnWidths();
  }

  get dataModel(): ViewBasedJSONModel {
    return this._dataModel;
  }

  set baseRowSize(size: number) {
    this._baseRowSize = size;

    if (!this.grid) {
      return;
    }

    this.grid.defaultSizes = { ...this.grid.defaultSizes, rowHeight: size };
  }

  get baseRowSize(): number {
    return this._baseRowSize;
  }

  set baseColumnSize(size: number) {
    this._baseColumnSize = size;

    if (!this.grid) {
      return;
    }

    this.grid.defaultSizes = { ...this.grid.defaultSizes, columnWidth: size };
    this._updateColumnWidths();
  }

  get baseColumnSize(): number {
    return this._baseColumnSize;
  }

  set columnWidths(widths: Dict<number>) {
    this._columnWidths = widths;

    if (!this.grid) {
      return;
    }

    this._updateColumnWidths();
  }

  get columnWidths(): Dict<number> {
    return this._columnWidths;
  }

  set baseRowHeaderSize(size: number) {
    this._baseRowHeaderSize = size;

    if (!this.grid) {
      return;
    }

    this.grid.defaultSizes = {
      ...this.grid.defaultSizes,
      rowHeaderWidth: size,
    };
    this._updateColumnWidths();
  }

  get baseRowHeaderSize(): number {
    return this._baseRowHeaderSize;
  }

  set baseColumnHeaderSize(size: number) {
    this._baseColumnHeaderSize = size;

    if (!this.grid) {
      return;
    }

    this.grid.defaultSizes = {
      ...this.grid.defaultSizes,
      columnHeaderHeight: size,
    };
  }

  get baseColumnHeaderSize(): number {
    return this._baseColumnHeaderSize;
  }

  set headerVisibility(visibility: DataGrid.HeaderVisibility) {
    this._headerVisibility = visibility;

    if (!this.grid) {
      return;
    }

    this.grid.headerVisibility = visibility;
    this._updateColumnWidths();
  }

  get headerVisibility(): DataGrid.HeaderVisibility {
    return this._headerVisibility;
  }

  set defaultRenderer(renderer: CellRenderer) {
    this._defaultRenderer = renderer;
    this._defaultRendererSet = true;

    if (!this.grid) {
      return;
    }

    this._updateGridRenderers();
  }

  get defaultRenderer(): CellRenderer {
    return this._defaultRenderer;
  }

  set columnHeaderRenderer(renderer: CellRenderer) {
    const textRenderer = renderer as TextRenderer;

    // HeaderRenderer adds the filter dialogue box overlay
    this._columnHeaderRenderer = new HeaderRenderer({
      textOptions: {
        font: textRenderer.font,
        wrapText: textRenderer.wrapText,
        elideDirection: textRenderer.elideDirection,
        textColor: textRenderer.textColor,
        backgroundColor:
          this.grid.style.headerBackgroundColor ||
          textRenderer.backgroundColor ||
          Theme.getBackgroundColor(),
        verticalAlignment: textRenderer.verticalAlignment,
        horizontalAlignment: textRenderer.horizontalAlignment,
        format: textRenderer.format,
      },
      isLightTheme: this._isLightTheme,
      grid: this.grid,
    });

    if (!this.grid) {
      return;
    }

    this._updateHeaderRenderer();
  }

  get columnHeaderRenderer(): CellRenderer {
    return this._columnHeaderRenderer;
  }

  set cornerHeaderRenderer(renderer: CellRenderer) {
    const textRenderer = renderer as TextRenderer;

    // HeaderRenderer adds the filter dialogue box overlay
    this._cornerHeaderRenderer = new HeaderRenderer({
      textOptions: {
        font: textRenderer.font,
        wrapText: textRenderer.wrapText,
        elideDirection: textRenderer.elideDirection,
        textColor: textRenderer.textColor,
        backgroundColor:
          this.grid.style.headerBackgroundColor ||
          textRenderer.backgroundColor ||
          Theme.getBackgroundColor(),
        verticalAlignment: textRenderer.verticalAlignment,
        horizontalAlignment: textRenderer.horizontalAlignment,
        format: textRenderer.format,
      },
      isLightTheme: this._isLightTheme,
      grid: this.grid,
    });

    if (!this.grid) {
      return;
    }

    this._updateHeaderRenderer();
  }

  get cornerHeaderRenderer(): CellRenderer {
    return this._cornerHeaderRenderer;
  }

  set renderers(renderers: Dict<CellRenderer>) {
    this._renderers = renderers;

    if (!this.grid) {
      return;
    }

    this._updateGridRenderers();
  }

  get renderers(): Dict<CellRenderer> {
    return this._renderers;
  }

  set selectionModel(model: BasicSelectionModel | null) {
    this._selectionModel = model;

    if (!this.grid) {
      return;
    }

    this.grid.selectionModel = this._selectionModel;
  }

  set editable(value: boolean) {
    this._editable = value;

    if (!this.grid) {
      return;
    }

    this.grid.editingEnabled = value;
  }

  get editable(): boolean {
    return this._editable;
  }

  get cellRenderers(): RendererMap {
    return this.grid.cellRenderers;
  }

  private _createGrid(options: DataGrid.IOptions = {}) {
    this.grid = new DataGrid({
      ...options,
      ...{
        defaultSizes: {
          rowHeight: this._baseRowSize,
          columnWidth: this._baseColumnSize,
          rowHeaderWidth: this._baseRowHeaderSize,
          columnHeaderHeight: this._baseColumnHeaderSize,
        },
        headerVisibility: this._headerVisibility,
      },
    });

    MessageLoop.installMessageHook(this.grid.viewport, this);

    this._filterDialog = new InteractiveFilterDialog({
      model: this._dataModel,
    });

    this.contextMenu = new FeatherGridContextMenu({
      grid: this.grid,
      commands: this._createCommandRegistry(),
    });

    // Replace method of copying to clipboard with one that allows
    // a ClipboardEvent to reach document.body
    this.grid.copyToClipboard = this.copyToClipboard.bind(this.grid);

    this.grid.dataModel = this._dataModel;
    this.grid.keyHandler = new KeyHandler();
    const mouseHandler = new FeatherGridMouseHandler(this);
    mouseHandler.cellClicked.connect(
      (sender: FeatherGridMouseHandler, hit: DataGrid.HitTestResult) => {
        if (!this.grid.dataModel) {
          return;
        }
        const dataModel = this.grid.dataModel as ViewBasedJSONModel;
        const region = hit.region as DataModel.CellRegion;
        this._cellClicked.emit({
          region: region as DataModel.CellRegion,
          column: dataModel.metadata(region, hit.row, hit.column)['name'],
          columnIndex: hit.column,
          row: hit.row,
          primaryKeyRow: dataModel.getDatasetRowFromView(region, hit.row),
          cellValue: dataModel.data(region, hit.row, hit.column),
        });
      },
    );

    this.grid.mouseHandler = mouseHandler;
    this.grid.selectionModel = this._selectionModel;
    this.grid.editingEnabled = this._editable;

    this.updateGridStyle();
    this._updateGridRenderers();
    this._updateColumnWidths();
  }

  public setGridStyle(): void {
    // Setting up theme.
    const scrollShadow = {
      size: 4,
      color1: Theme.getBorderColor(1, 1.0),
      color2: Theme.getBorderColor(1, 0.5),
      color3: Theme.getBorderColor(1, 0.0),
    };

    // Resetting grid style if theme changes.
    if (this.backboneModel) {
      this.grid.style = this.backboneModel.get('grid_style');
    }
    // Always apply FeatherGrid Theme
    // if not rendered in ipydatagrid.
    else {
      this.grid.style = {
        voidColor: Theme.getBackgroundColor(),
        backgroundColor: Theme.getBackgroundColor(),
        gridLineColor: Theme.getBorderColor(),
        headerGridLineColor: Theme.getBorderColor(1),
        selectionFillColor: Theme.getBrandColor(2, 0.4),
        selectionBorderColor: Theme.getBrandColor(1),
        headerSelectionFillColor: Theme.getBackgroundColor(3, 0.4),
        headerSelectionBorderColor: Theme.getBorderColor(1),
        cursorFillColor: Theme.getBrandColor(3, 0.4),
        cursorBorderColor: Theme.getBrandColor(1),
        scrollShadow,
      };
      // Terminate call here if rendering outside ipydatagrid.
      return;
    }

    this.grid.style = {
      voidColor: this.grid.style.voidColor || Theme.getBackgroundColor(),
      backgroundColor:
        this.grid.style.backgroundColor || Theme.getBackgroundColor(),
      rowBackgroundColor: this.grid.style.rowBackgroundColor || undefined,
      columnBackgroundColor: this.grid.style.columnBackgroundColor || undefined,
      gridLineColor: this.grid.style.gridLineColor || Theme.getBorderColor(),
      verticalGridLineColor: this.grid.style.verticalGridLineColor || undefined,
      horizontalGridLineColor:
        this.grid.style.horizontalGridLineColor || undefined,
      headerBackgroundColor: this.grid.style.headerBackgroundColor || undefined,
      headerGridLineColor:
        this.grid.style.headerGridLineColor || Theme.getBorderColor(1),
      headerVerticalGridLineColor:
        this.grid.style.headerVerticalGridLineColor || undefined,
      headerHorizontalGridLineColor:
        this.grid.style.headerHorizontalGridLineColor || undefined,
      selectionFillColor:
        this.grid.style.selectionFillColor || Theme.getBrandColor(2, 0.4),
      selectionBorderColor:
        this.grid.style.selectionBorderColor || Theme.getBrandColor(1),
      headerSelectionFillColor:
        this.grid.style.headerSelectionFillColor ||
        Theme.getBackgroundColor(3, 0.4),
      headerSelectionBorderColor:
        this.grid.style.headerSelectionBorderColor || Theme.getBorderColor(1),
      cursorFillColor:
        this.grid.style.cursorFillColor || Theme.getBrandColor(3, 0.4),
      cursorBorderColor:
        this.grid.style.cursorBorderColor || Theme.getBrandColor(1),
      scrollShadow: this.grid.style.scrollShadow || scrollShadow,
    };
  }

  public updateGridStyle(): void {
    this.setGridStyle();

    // If we are not rendering with ipydatagrid,
    // defaultRenderer needs to be set each time.
    if (!this._defaultRendererSet || !this.backboneModel) {
      this.defaultRenderer = new TextRenderer({
        font: '12px sans-serif',
        textColor: Theme.getFontColor(),
        backgroundColor:
          this.grid.style.backgroundColor || Theme.getBackgroundColor(),
        horizontalAlignment: 'left',
        verticalAlignment: 'center',
      });
    }

    this._rowHeaderRenderer = new TextRenderer({
      textColor: Theme.getFontColor(1),
      backgroundColor:
        this.grid.style.headerBackgroundColor || Theme.getBackgroundColor(2),
      horizontalAlignment: 'center',
      verticalAlignment: 'center',
    });

    this._columnHeaderRenderer = new HeaderRenderer({
      textOptions: {
        textColor: Theme.getFontColor(1),
        backgroundColor:
          this.grid.style.headerBackgroundColor || Theme.getBackgroundColor(2),
        horizontalAlignment: 'left',
        verticalAlignment: 'center',
      },
      isLightTheme: this._isLightTheme,
      grid: this.grid,
    });

    this._cornerHeaderRenderer = new HeaderRenderer({
      textOptions: {
        textColor: Theme.getFontColor(1),
        backgroundColor:
          this.grid.style.headerBackgroundColor || Theme.getBackgroundColor(2),
        horizontalAlignment: 'left',
        verticalAlignment: 'center',
      },
      isLightTheme: this._isLightTheme,
      grid: this.grid,
    });

    this._updateHeaderRenderer();
  }

  copyToClipboard(): void {
    const grid = <DataGrid>(<unknown>this);
    // Fetch the data model.
    const dataModel = grid.dataModel;

    // Bail early if there is no data model.
    if (!dataModel) {
      return;
    }

    // Fetch the selection model.
    const selectionModel = grid.selectionModel;

    // Bail early if there is no selection model.
    if (!selectionModel) {
      return;
    }

    // Coerce the selections to an array.
    const selections = toArray(selectionModel.selections());

    // Bail early if there are no selections.
    if (selections.length === 0) {
      return;
    }

    // Alert that multiple selections cannot be copied.
    if (selections.length > 1) {
      alert('Cannot copy multiple grid selections.');
      return;
    }

    // Fetch the model counts.
    const br = dataModel.rowCount('body');
    const bc = dataModel.columnCount('body');

    // Bail early if there is nothing to copy.
    if (br === 0 || bc === 0) {
      return;
    }

    // Unpack the selection.
    let { r1, c1, r2, c2 } = selections[0];

    // Clamp the selection to the model bounds.
    r1 = Math.max(0, Math.min(r1, br - 1));
    c1 = Math.max(0, Math.min(c1, bc - 1));
    r2 = Math.max(0, Math.min(r2, br - 1));
    c2 = Math.max(0, Math.min(c2, bc - 1));

    // Ensure the limits are well-orderd.
    if (r2 < r1) [r1, r2] = [r2, r1];
    if (c2 < c1) [c1, c2] = [c2, c1];

    // Fetch the header counts.
    let rhc = dataModel.columnCount('row-header');
    let chr = dataModel.rowCount('column-header');

    // Unpack the copy config.
    const separator = grid.copyConfig.separator;
    const format = grid.copyConfig.format;
    const headers = grid.copyConfig.headers;
    const warningThreshold = grid.copyConfig.warningThreshold;

    // Compute the number of cells to be copied.
    let rowCount = r2 - r1 + 1;
    let colCount = c2 - c1 + 1;
    switch (headers) {
      case 'none':
        rhc = 0;
        chr = 0;
        break;
      case 'row':
        chr = 0;
        colCount += rhc;
        break;
      case 'column':
        rhc = 0;
        rowCount += chr;
        break;
      case 'all':
        rowCount += chr;
        colCount += rhc;
        break;
      default:
        throw 'unreachable';
    }

    // Compute the total cell count.
    const cellCount = rowCount * colCount;

    // Allow the user to cancel a large copy request.
    if (cellCount > warningThreshold) {
      const msg = `Copying ${cellCount} cells may take a while. Continue?`;
      if (!window.confirm(msg)) {
        return;
      }
    }

    // Set up the format args.
    const args = {
      region: 'body' as DataModel.CellRegion,
      row: 0,
      column: 0,
      value: null as any,
      metadata: {} as DataModel.Metadata,
    };

    // Allocate the array of rows.
    const rows = new Array<string[]>(rowCount);

    // Iterate over the rows.
    for (let j = 0; j < rowCount; ++j) {
      // Allocate the array of cells.
      const cells = new Array<string>(colCount);

      // Iterate over the columns.
      for (let i = 0; i < colCount; ++i) {
        // Set up the format variables.
        let region: DataModel.CellRegion;
        let row: number;
        let column: number;

        // Populate the format variables.
        if (j < chr && i < rhc) {
          region = 'corner-header';
          row = j;
          column = i;
        } else if (j < chr) {
          region = 'column-header';
          row = j;
          column = i - rhc + c1;
        } else if (i < rhc) {
          region = 'row-header';
          row = j - chr + r1;
          column = i;
        } else {
          region = 'body';
          row = j - chr + r1;
          column = i - rhc + c1;
        }

        // Populate the format args.
        args.region = region;
        args.row = row;
        args.column = column;
        args.value = dataModel.data(region, row, column);
        args.metadata = dataModel.metadata(region, row, column);

        // Format the cell.
        cells[i] = format(args);
      }

      // Save the row of cells.
      rows[j] = cells;
    }

    // Convert the cells into lines.
    const lines = rows.map((cells) => cells.join(separator));

    // Convert the lines into text.
    const text = lines.join('\n');

    // Copy the text to the clipboard.
    const textArea = document.createElement('textarea');
    textArea.innerHTML = text;

    // Text area has to be visible on page for copy without Clipboard API,
    // So we create an "invisible" element, add it to the body, then remove
    // when no longer needed.

    textArea.style.height = '0px';
    textArea.style.width = '0px';
    textArea.style.overflow = 'hidden';
    textArea.id = 'ipydatagrid-textarea';
    textArea.style.position = 'absolute';
    document.body.appendChild(textArea);
    textArea.select();
    document.execCommand('copy');
    document.body.removeChild(textArea);
  }

  /**
   * A signal emitted when a grid cell is clicked.
   */
  get cellClicked(): ISignal<this, FeatherGrid.ICellClickedEvent> {
    return this._cellClicked;
  }

  /**
   * A signal emitted when a grid column is resized.
   */
  get columnsResized(): ISignal<this, void> {
    return this._columnsResized;
  }

  set isLightTheme(value: boolean) {
    this._isLightTheme = value;

    let themeIndex = 0;
    if (value) {
      this.removeClass('dark');
    } else {
      this.addClass('dark');
      themeIndex = 1;
    }

    const root = document.documentElement;
    themeVariables.forEach((options: string[], name: string) => {
      root.style.setProperty(name, options[themeIndex]);
    });

    this.updateGridStyle();
  }

  get isLightTheme(): boolean {
    return this._isLightTheme;
  }

  /**
   *
   * RendererMap.Resolver function to select a CellRenderer based on the
   * provided cell metadata.
   *
   * @param config - CellConfig for the cell to be rendered.
   */
  private _rendererResolver(config: CellRenderer.CellConfig): CellRenderer {
    const columnName: string = config.metadata['name'];
    const cellRegion: string = config['region'];
    return this._renderers.hasOwnProperty(columnName)
      ? this._renderers[columnName]
      : cellRegion === 'row-header'
        ? this._rowHeaderRenderer
        : this._defaultRenderer;
  }

  private _updateGridRenderers() {
    this.grid.cellRenderers.update({ body: this._rendererResolver.bind(this) });
    this.grid.cellRenderers.update({
      'row-header': this._rendererResolver.bind(this),
    });
  }

  private _updateColumnWidths() {
    const columnWidths = this._columnWidths;
    const mouseHandler = this.grid.mouseHandler as FeatherGridMouseHandler | null;

    // Check we have a mouse handler
    if (mouseHandler && mouseHandler.isResizing) {
      // Do not want this callback to be executed when user resizes using the mouse
      return;
    }

    // Resizing columns from row header region
    if (this._headerVisibility === 'row' || this._headerVisibility === 'all') {
      const baseRowHeaderSize = this._baseRowHeaderSize;
      const rowHeaderColCount = this.grid.columnCount('row-header');
      for (let i = 0; i < rowHeaderColCount; i++) {
        const colName = this.dataModel.columnIndexToName(i, 'row-header');
        const colSize = columnWidths.hasOwnProperty(colName)
          ? columnWidths[colName]
          : baseRowHeaderSize;

        this.grid.resizeColumn('row-header', i, colSize);
      }
    }

    // Resizing columns from body region
    const baseColumnSize = this._baseColumnSize;
    const bodyColCount = this.grid.columnCount('body');
    for (let i = 0; i < bodyColCount; i++) {
      const colName = this.dataModel.columnIndexToName(i, 'body');
      const colSize = columnWidths.hasOwnProperty(colName)
        ? columnWidths[colName]
        : baseColumnSize;

      this.grid.resizeColumn('body', i, colSize);
    }
  }

  private _updateHeaderRenderer() {
    this.grid.cellRenderers.update({
      'column-header': this._columnHeaderRenderer,
    });
    // Treating corner-header as column-header if a value has not
    // been passed for the former.
    let hasCornerRenderer = false;
    if (this.backboneModel) {
      hasCornerRenderer = this.backboneModel.get('corner_renderer') !== null;
    }

    this.grid.cellRenderers.update({
      'corner-header': hasCornerRenderer
        ? this._cornerHeaderRenderer
        : this._columnHeaderRenderer,
    });
  }

  private _createCommandRegistry(): CommandRegistry {
    const commands = new CommandRegistry();
    commands.addCommand(FeatherGridContextMenu.CommandID.SortAscending, {
      label: 'Sort Ascending',
      mnemonic: 1,
      iconClass:
        'ipydatagrid-filterMenuIcon ipydatagrid-filterMenuIcon-sortAsc',
      execute: (args): void => {
        const cellClick: FeatherGridContextMenu.CommandArgs =
          args as FeatherGridContextMenu.CommandArgs;
        const colIndex = this._dataModel.getSchemaIndex(
          cellClick.region,
          cellClick.columnIndex,
        );
        this._dataModel.addTransform({
          type: 'sort',
          columnIndex: colIndex,
          desc: false,
        });
      },
    });
    commands.addCommand(FeatherGridContextMenu.CommandID.SortDescending, {
      label: 'Sort Descending',
      mnemonic: 1,
      iconClass:
        'ipydatagrid-filterMenuIcon ipydatagrid-filterMenuIcon-sortDesc',
      execute: (args) => {
        const cellClick: FeatherGridContextMenu.CommandArgs =
          args as FeatherGridContextMenu.CommandArgs;
        const colIndex = this._dataModel.getSchemaIndex(
          cellClick.region,
          cellClick.columnIndex,
        );
        this._dataModel.addTransform({
          type: 'sort',
          columnIndex: colIndex,
          desc: true,
        });
      },
    });
    commands.addCommand(FeatherGridContextMenu.CommandID.ClearThisFilter, {
      label: 'Clear This Filter',
      mnemonic: -1,
      execute: (args) => {
        const commandArgs = <FeatherGridContextMenu.CommandArgs>args;
        const schemaIndex: number = this._dataModel.getSchemaIndex(
          commandArgs.region,
          commandArgs.columnIndex,
        );
        this._dataModel.removeTransform(schemaIndex, 'filter');
      },
    });
    commands.addCommand(
      FeatherGridContextMenu.CommandID.ClearFiltersInAllColumns,
      {
        label: 'Clear Filters in All Columns',
        mnemonic: -1,
        execute: (args) => {
          const activeTransforms: Transform.TransformSpec[] =
            this._dataModel.activeTransforms;
          const newTransforms = activeTransforms.filter(
            (val) => val.type !== 'filter',
          );
          this._dataModel.replaceTransforms(newTransforms);
        },
      },
    );
    commands.addCommand(
      FeatherGridContextMenu.CommandID.OpenFilterByConditionDialog,
      {
        label: 'Filter by condition...',
        mnemonic: 4,
        iconClass:
          'ipydatagrid-filterMenuIcon ipydatagrid-filterMenuIcon-filter',
        execute: (args) => {
          const commandArgs = <FeatherGridContextMenu.CommandArgs>args;
          this._filterDialog.open({
            x: commandArgs.clientX,
            y: commandArgs.clientY,
            region: commandArgs.region,
            columnIndex: commandArgs.columnIndex,
            forceX: false,
            forceY: false,
            mode: 'condition',
          });
        },
      },
    );
    commands.addCommand(
      FeatherGridContextMenu.CommandID.OpenFilterByValueDialog,
      {
        label: 'Filter by value...',
        mnemonic: 4,
        iconClass:
          'ipydatagrid-filterMenuIcon ipydatagrid-filterMenuIcon-filter',
        execute: (args) => {
          const commandArgs = <FeatherGridContextMenu.CommandArgs>args;
          this._filterDialog.open({
            x: commandArgs.clientX,
            y: commandArgs.clientY,
            region: commandArgs.region,
            columnIndex: commandArgs.columnIndex,
            forceX: false,
            forceY: false,
            mode: 'value',
          });
        },
      },
    );
    return commands;
  }

  grid: DataGrid;
  backboneModel: BackBoneModel;
  contextMenu: FeatherGridContextMenu;
  private _filterDialog: InteractiveFilterDialog;
  private _baseRowSize = 20;
  private _baseColumnSize = 64;
  private _baseRowHeaderSize = 64;
  private _baseColumnHeaderSize = 20;
  private _columnWidths: Dict<number> = {};
  private _headerVisibility: DataGrid.HeaderVisibility = 'all';
  private _dataModel: ViewBasedJSONModel;
  private _selectionModel: BasicSelectionModel | null;
  private _editable: boolean;
  private _renderers: Dict<CellRenderer> = {};
  private _defaultRenderer: CellRenderer;
  private _columnHeaderRenderer: CellRenderer;
  private _cornerHeaderRenderer: CellRenderer;
  private _rowHeaderRenderer: CellRenderer;
  private _defaultRendererSet = false;
  private _cellClicked = new Signal<this, FeatherGrid.ICellClickedEvent>(this);
  private _columnsResized = new Signal<this, void>(this);
  private _isLightTheme = true;
}

/**
 * The namespace for the `FeatherGrid` class statics.
 */
export namespace FeatherGrid {
  export interface ICellClickedEvent {
    readonly region: DataModel.CellRegion;
    column: string;
    columnIndex: number;
    row: number;
    primaryKeyRow: number;
    cellValue: any;
  }
}
