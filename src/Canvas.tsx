import React, { useRef, useState, useImperativeHandle, useEffect, forwardRef } from 'react';

import { ColumnMetrics, Position, ScrollPosition, CalculatedColumn, SelectRowEvent } from './common/types';
import { EventTypes } from './common/enums';
import EventBus from './EventBus';
import InteractionMasks from './masks/InteractionMasks';
import { DataGridProps } from './DataGrid';
import RowRenderer from './RowRenderer';
import SummaryRowRenderer from './SummaryRowRenderer';
import { getColumnScrollPosition, getScrollbarSize, isPositionStickySupported, getVerticalRangeToRender } from './utils';

type SharedDataGridProps<R, K extends keyof R> = Pick<DataGridProps<R, K>,
| 'rows'
| 'rowRenderer'
| 'rowGroupRenderer'
| 'contextMenu'
| 'RowsContainer'
| 'selectedRows'
| 'summaryRows'
| 'onCheckCellIsEditable'
| 'onSelectedCellChange'
| 'onSelectedCellRangeChange'
| 'onRowClick'
| 'onRowDoubleClick'
| 'onRowExpandToggle'
| 'onSelectedRowsChange'
> & Required<Pick<DataGridProps<R, K>,
| 'rowKey'
| 'enableCellAutoFocus'
| 'enableCellSelect'
| 'enableCellCopyPaste'
| 'enableCellDragAndDrop'
| 'rowHeight'
| 'cellNavigationMode'
| 'editorPortalTarget'
| 'renderBatchSize'
| 'onGridRowsUpdated'
>>;

export interface CanvasProps<R, K extends keyof R> extends SharedDataGridProps<R, K> {
  columnMetrics: ColumnMetrics<R>;
  viewportColumns: readonly CalculatedColumn<R>[];
  height: number;
  scrollLeft: number;
  onScroll(position: ScrollPosition): void;
  onCanvasKeydown?(e: React.KeyboardEvent<HTMLDivElement>): void;
  onCanvasKeyup?(e: React.KeyboardEvent<HTMLDivElement>): void;
}

export interface CanvasHandle {
  scrollToColumn(colIdx: number): void;
  scrollToRow(rowIdx: number): void;
  selectCell(position: Position, openEditor?: boolean): void;
  openCellEditor(rowIdx: number, colIdx: number): void;
}

function Canvas<R, K extends keyof R>({
  columnMetrics,
  viewportColumns,
  contextMenu,
  height,
  scrollLeft,
  onScroll,
  renderBatchSize,
  rows,
  rowHeight,
  rowKey,
  RowsContainer,
  summaryRows,
  selectedRows,
  onSelectedRowsChange,
  ...props
}: CanvasProps<R, K>, ref: React.Ref<CanvasHandle>) {
  const [eventBus] = useState(() => new EventBus());
  const [scrollTop, setScrollTop] = useState(0);
  const canvas = useRef<HTMLDivElement>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const lastSelectedRowIdx = useRef(-1);

  const clientHeight = getClientHeight();
  const nonStickyScrollLeft = isPositionStickySupported() ? undefined : scrollLeft;
  const { columns, lastFrozenColumnIndex } = columnMetrics;

  const [rowOverscanStartIdx, rowOverscanEndIdx] = getVerticalRangeToRender(
    clientHeight,
    rowHeight,
    scrollTop,
    rows.length,
    renderBatchSize
  );

  function handleScroll(e: React.UIEvent<HTMLDivElement>) {
    const { scrollLeft, scrollTop } = e.currentTarget;
    setScrollTop(scrollTop);
    onScroll({ scrollLeft, scrollTop });
    if (summaryRef.current) {
      summaryRef.current.scrollLeft = scrollLeft;
    }
  }

  function getClientHeight() {
    const scrollbarSize = columnMetrics.totalColumnWidth > columnMetrics.viewportWidth ? getScrollbarSize() : 0;
    return height - scrollbarSize;
  }

  function getFrozenColumnsWidth() {
    if (lastFrozenColumnIndex === -1) return 0;
    const lastFrozenCol = columns[lastFrozenColumnIndex];
    return lastFrozenCol.left + lastFrozenCol.width;
  }

  function scrollToCell({ idx, rowIdx }: Partial<Position>) {
    const { current } = canvas;
    if (!current) return;

    const { clientWidth, clientHeight, scrollLeft, scrollTop } = current;

    if (typeof idx === 'number' && idx > lastFrozenColumnIndex) {
      const { left, width } = columns[idx];
      const isCellAtLeftBoundary = left < scrollLeft + width + getFrozenColumnsWidth();
      const isCellAtRightBoundary = left + width > clientWidth + scrollLeft;
      if (isCellAtLeftBoundary || isCellAtRightBoundary) {
        const newScrollLeft = getColumnScrollPosition(columns, idx, scrollLeft, clientWidth);
        current.scrollLeft = scrollLeft + newScrollLeft;
      }
    }

    if (typeof rowIdx === 'number') {
      if (rowIdx * rowHeight < scrollTop) {
        // at top boundary, scroll to the row's top
        current.scrollTop = rowIdx * rowHeight;
      } else if ((rowIdx + 1) * rowHeight > scrollTop + clientHeight) {
        // at bottom boundary, scroll the next row's top to the bottom of the viewport
        current.scrollTop = (rowIdx + 1) * rowHeight - clientHeight;
      }
    }
  }

  function scrollToColumn(idx: number) {
    scrollToCell({ idx });
  }

  function scrollToRow(rowIdx: number) {
    const { current } = canvas;
    if (!current) return;
    current.scrollTop = rowIdx * rowHeight;
  }

  function selectCell(position: Position, openEditor?: boolean) {
    eventBus.dispatch(EventTypes.SELECT_CELL, position, openEditor);
  }

  function openCellEditor(rowIdx: number, idx: number) {
    selectCell({ rowIdx, idx }, true);
  }

  useEffect(() => {
    if (!onSelectedRowsChange) return;

    const handleRowSelectionChange = ({ rowIdx, row, checked, isShiftClick }: SelectRowEvent<R>) => {
      const newSelectedRows = new Set(selectedRows);

      if (checked) {
        newSelectedRows.add(row[rowKey]);
        const previousRowIdx = lastSelectedRowIdx.current;
        lastSelectedRowIdx.current = rowIdx;
        if (isShiftClick && previousRowIdx !== -1 && previousRowIdx !== rowIdx) {
          const step = Math.sign(rowIdx - previousRowIdx);
          for (let i = previousRowIdx + step; i !== rowIdx; i += step) {
            newSelectedRows.add(rows[i][rowKey]);
          }
        }
      } else {
        newSelectedRows.delete(row[rowKey]);
        lastSelectedRowIdx.current = -1;
      }

      onSelectedRowsChange(newSelectedRows);
    };

    return eventBus.subscribe(EventTypes.SELECT_ROW, handleRowSelectionChange);
  }, [eventBus, onSelectedRowsChange, rows, rowKey, selectedRows]);

  useImperativeHandle(ref, () => ({
    scrollToColumn,
    scrollToRow,
    selectCell,
    openCellEditor
  }));

  function getViewportRows() {
    const rowElements = [];
    for (let idx = rowOverscanStartIdx; idx <= rowOverscanEndIdx; idx++) {
      const rowData = rows[idx];
      rowElements.push(
        <RowRenderer<R, K>
          key={idx}
          idx={idx}
          rowData={rowData}
          columnMetrics={columnMetrics}
          viewportColumns={viewportColumns}
          eventBus={eventBus}
          rowGroupRenderer={props.rowGroupRenderer}
          rowHeight={rowHeight}
          rowKey={rowKey}
          rowRenderer={props.rowRenderer}
          scrollLeft={nonStickyScrollLeft}
          isRowSelected={selectedRows?.has(rowData[rowKey]) ?? false}
          onRowClick={props.onRowClick}
          onRowDoubleClick={props.onRowDoubleClick}
          onRowExpandToggle={props.onRowExpandToggle}
          enableCellRangeSelection={typeof props.onSelectedCellRangeChange === 'function'}
        />
      );
    }

    return rowElements;
  }

  let grid = (
    <div
      className="rdg-grid"
      style={{
        width: columnMetrics.totalColumnWidth,
        paddingTop: rowOverscanStartIdx * rowHeight,
        paddingBottom: (rows.length - 1 - rowOverscanEndIdx) * rowHeight
      }}
    >
      {getViewportRows()}
    </div>
  );

  if (RowsContainer !== undefined) {
    grid = <RowsContainer id={contextMenu ? contextMenu.props.id : 'rowsContainer'}>{grid}</RowsContainer>;
  }

  const summary = summaryRows && summaryRows.length > 0 && (
    <div ref={summaryRef} className="rdg-summary">
      {summaryRows.map((rowData, idx) => (
        <SummaryRowRenderer<R, K>
          key={idx}
          idx={idx}
          rowData={rowData}
          columnMetrics={columnMetrics}
          viewportColumns={viewportColumns}
          rowHeight={rowHeight}
          scrollLeft={nonStickyScrollLeft}
          eventBus={eventBus}
        />
      ))}
    </div>
  );

  return (
    <>
      <div
        className="rdg-viewport"
        style={{ height: height - 2 - (summaryRows ? summaryRows.length * rowHeight + 2 : 0) }}
        ref={canvas}
        onScroll={handleScroll}
        onKeyDown={props.onCanvasKeydown}
        onKeyUp={props.onCanvasKeyup}
      >
        <InteractionMasks<R, K>
          rows={rows}
          rowHeight={rowHeight}
          columns={columns}
          height={clientHeight}
          enableCellSelect={props.enableCellSelect}
          enableCellAutoFocus={props.enableCellAutoFocus}
          enableCellCopyPaste={props.enableCellCopyPaste}
          enableCellDragAndDrop={props.enableCellDragAndDrop}
          cellNavigationMode={props.cellNavigationMode}
          eventBus={eventBus}
          contextMenu={contextMenu}
          canvasRef={canvas}
          scrollLeft={scrollLeft}
          scrollTop={scrollTop}
          scrollToCell={scrollToCell}
          editorPortalTarget={props.editorPortalTarget}
          onCheckCellIsEditable={props.onCheckCellIsEditable}
          onGridRowsUpdated={props.onGridRowsUpdated}
          onSelectedCellChange={props.onSelectedCellChange}
          onSelectedCellRangeChange={props.onSelectedCellRangeChange}
        />
        {grid}
      </div>
      {summary}
    </>
  );
}

export default forwardRef(
  Canvas as React.RefForwardingComponent<CanvasHandle, CanvasProps<{ [key: string]: unknown }, string>>
) as <R, K extends keyof R>(props: CanvasProps<R, K> & { ref?: React.Ref<CanvasHandle> }) => JSX.Element;
