import React, { Component } from 'react';
import { HeaderItem, HeaderRow, Table, TableRow } from '../Table';
import Blocktime from '../../components/Blocktime';
import PropTypes from 'prop-types';
import { withRouter } from 'react-router';
import { connect } from 'react-redux';
import cn from 'classnames';
import { Resource } from 'hsd/lib/dns/resource';
import Network from 'hsd/lib/protocol/network';
import CreateRecord from './CreateRecord';
import Record from './Record';
import EditableRecord from './EditableRecord';
import * as nameActions from '../../ducks/names';
import deepEqual from 'deep-equal';
import * as logger from '../../utils/logClient';
import { showSuccess } from '../../ducks/notifications';
import { clientStub as aClientStub } from '../../background/analytics/client';
import './records.scss';
import {clearDeeplinkParams} from "../../ducks/app";
import {deserializeRecord, serializeRecord} from '../../utils/recordHelpers';
import {I18nContext} from "../../utils/i18n";
import fs from 'fs';
import nodeClient from '../../utils/nodeClient';
import {assertCanonicalStillCurrent, parseActivateProposal} from '../../utils/activateProposal';

const {dialog} = require('electron');

const analytics = aClientStub(() => require('electron').ipcRenderer);

const DEFAULT_RESOURCE = {
  records: [],
};

function cloneResource(resource) {
  return resource ? JSON.parse(JSON.stringify(resource)) : null;
}

function makeDefaultResource() {
  return cloneResource(DEFAULT_RESOURCE);
}

export class Records extends Component {
  static contextType = I18nContext;

  static propTypes = {
    name: PropTypes.string.isRequired,
    resource: PropTypes.object,
    pendingData: PropTypes.object,
    deeplinkParams: PropTypes.object.isRequired,
    showSuccess: PropTypes.func.isRequired,
    sendUpdate: PropTypes.func.isRequired,
    clearDeeplinkParams: PropTypes.func.isRequired,
    transferring: PropTypes.bool.isRequired,
    editable: PropTypes.bool,
    network: PropTypes.string.isRequired,
    loadCanonicalNameInfo: PropTypes.func.isRequired,
    refreshCanonicalNameInfo: PropTypes.func.isRequired,
    canonicalLoading: PropTypes.bool,
    canonicalError: PropTypes.string,
    openProposalFile: PropTypes.func.isRequired,
    readProposalFile: PropTypes.func.isRequired,
  };

  shouldComponentUpdate(nextProps, nextState, nextContext) {
    return !deepEqual(this.props, nextProps) || !deepEqual(this.state, nextState);
  }

  constructor(props) {
    super(props);
    const canonicalResource = cloneResource(props.resource);
    this.state = {
      isUpdating: false,
      errorMessage: '',
      updatedResource: canonicalResource || makeDefaultResource(),
      canonicalResource,
      resourceName: props.name,
      isDirty: false,
      isRefreshingRecords: false,
      refreshError: '',
      importReview: null,
      isImporting: false,
    };
  }

  static getDerivedStateFromProps(props, state) {
    const nameChanged = props.name !== state.resourceName;
    const canonicalChanged = !deepEqual(props.resource || null, state.canonicalResource);
    let nextState = null;

    if (nameChanged) {
      const canonicalResource = cloneResource(props.resource);
      nextState = {
        resourceName: props.name,
        canonicalResource,
        updatedResource: canonicalResource || makeDefaultResource(),
        isDirty: false,
        refreshError: '',
        importReview: null,
      };
    } else if (canonicalChanged) {
      const canonicalResource = cloneResource(props.resource);
      nextState = {
        canonicalResource,
        ...(!state.isDirty ? {
          updatedResource: canonicalResource || makeDefaultResource(),
        } : {}),
      };
    }

    if (!!Object.keys(props.deeplinkParams).length && props.domain && props.domain.isOwner) {
      props.clearDeeplinkParams();
      const baseResource = cloneResource(
        (nextState && nextState.updatedResource) || state.updatedResource || props.resource
      ) || makeDefaultResource();

      const {raw, ...params} = props.deeplinkParams

      if (raw) {
        const { records } = Resource.decode(new Buffer(raw, 'hex')).toJSON();
        baseResource.records.push(...records);
      }

      Object.entries(params)
        .forEach(([type, value]) => {
          const record = deserializeRecord({type: type.toUpperCase(), value});
          baseResource.records.push(record)
        })

      return {
        ...(nextState || {}),
        updatedResource: baseResource,
        isDirty: true,
      };
    }

    return nextState;
  }

  hasChanged = () => {
    const oldResource = this.props.resource;
    const updatedResource = this.state.updatedResource;

    return !deepEqual(oldResource || DEFAULT_RESOURCE, updatedResource || DEFAULT_RESOURCE);
  };

  sendUpdate = async () => {
    const {t} = this.context;
    this.setState({isUpdating: true});
    try {
      const {updatedResource} = this.state;
      if (this.state.importReview) {
        const result = await this.props.loadCanonicalNameInfo(this.props.name);
        if (!result || !result.info) throw new Error('Bob could not reload canonical name information before submit.');
        assertCanonicalStillCurrent(this.state.importReview, result.info.data || '00');
      }
      const res = await this.props.sendUpdate(this.props.name, updatedResource);
      this.setState({
        isUpdating: false,
        ...(res !== null ? {isDirty: false} : {}),
      });
      if (res !== null) {
        this.props.showSuccess(t('updateSuccess'));
        analytics.track('updated domain');
      }
    } catch (e) {
      logger.error(`Error received from Records.js - sendUpdate\n\n${e.message}\n${e.stack}\n`);
      this.setState({
        isUpdating: false,
        errorMessage: e.message,
      });
    }
  };

  onCreate = async (record) => {
    const updatedResource = JSON.parse(JSON.stringify(this.state.updatedResource));
    updatedResource.records.push(record);
    this.setState({
      updatedResource,
      isDirty: true,
      importReview: null,
    });
  };

  onRemove = i => {
    const updatedResource = JSON.parse(JSON.stringify(this.state.updatedResource));
    updatedResource.records.splice(i, 1);
    this.setState({
      updatedResource,
      isDirty: true,
      importReview: null,
    });
  };

  makeOnEdit = i => async (record) => {
    const updatedResource = JSON.parse(JSON.stringify(this.state.updatedResource));
    updatedResource.records[i] = record;
    this.setState({
      updatedResource,
      isDirty: true,
      importReview: null,
    });
  };

  refreshRecords = async () => {
    if (this.state.isDirty || this.state.isRefreshingRecords) return;

    this.setState({isRefreshingRecords: true, refreshError: ''});
    try {
      await this.props.refreshCanonicalNameInfo(this.props.name);
      this.setState({isRefreshingRecords: false});
    } catch (error) {
      logger.error(`Error received from Records.js - refreshRecords\n\n${error.message}\n${error.stack}\n`);
      this.setState({
        isRefreshingRecords: false,
        refreshError: error.message || 'Canonical records could not be refreshed.',
      });
    }
  };

  onImportProposal = async () => {
    if (!this.props.domain || !this.props.domain.isOwner) {
      this.setState({errorMessage: 'Only the owner of this name can import a proposal.'});
      return;
    }
    if (this.props.pendingData) {
      this.setState({errorMessage: 'Wait for the pending name update before importing a proposal.'});
      return;
    }

    this.setState({isImporting: true, errorMessage: ''});
    try {
      const result = await this.props.openProposalFile({
        properties: ['openFile'],
        filters: [{name: 'LearnHNS activation proposal', extensions: ['json']}],
      });
      if (result.canceled || !result.filePaths || !result.filePaths[0]) {
        this.setState({isImporting: false});
        return;
      }

      const contents = await this.props.readProposalFile(result.filePaths[0]);
      const nameInfo = await this.props.loadCanonicalNameInfo(this.props.name);
      if (!nameInfo || !nameInfo.info) throw new Error('Bob could not independently load canonical name information.');
      const importReview = parseActivateProposal(contents, {
        expectedName: this.props.name,
        expectedNetwork: this.props.network,
        currentResourceHex: nameInfo.info.data || '00',
      });

      this.setState({
        updatedResource: importReview.afterResource,
        isDirty: true,
        importReview,
        isImporting: false,
        errorMessage: '',
      });
    } catch (error) {
      this.setState({
        isImporting: false,
        errorMessage: error.message,
      });
    }
  };

  renderRows() {
    const resource = this.state.updatedResource;
    const oldResource = this.props.resource;

    if (this.props.editable) {
      return resource.records.map((record, i) => {
        const oldrecord = oldResource && oldResource.records[i];
        return (
          <EditableRecord
            key={`${this.props.name}-${record.type}-${i}`}
            className={deepEqual(oldrecord, record) ? '' : 'edited-record'}
            name={this.props.name}
            record={record}
            onEdit={this.makeOnEdit(i)}
            onRemove={() => this.onRemove(i)}
            disabled={!this.props.domain || !this.props.domain.isOwner}
          />
        );
      });

    } else {
      const records = (this.props.resource && this.props.resource.records) || [];
      return records.map((record, i) => {
        return (
          <Record
            key={`${this.props.name}-${record.type}-${i}`}
            className="domain-detail-records"
            name={this.props.name}
            record={record}
          />
        );
      });
    }
  }

  renderCreateRecord() {
    return (
      <CreateRecord
        name={this.props.name}
        onCreate={this.onCreate}
        disabled={!this.props.domain || !this.props.domain.isOwner}
      />
    );
  }

  renderActionRow() {
    return (this.props.domain && this.props.domain.isOwner) && (
      <TableRow className="records-table__action-row">
        <div className="records-table__action-row__error-message">
          {this.state.errorMessage}
        </div>
        <button
          className="records-table__action-row__import-btn"
          disabled={this.state.isImporting || this.state.isUpdating || Boolean(this.props.pendingData)}
          onClick={this.onImportProposal}
        >
          {this.state.isImporting ? 'Importing…' : 'Import LearnHNS proposal'}
        </button>
        <button
          className="records-table__action-row__submit-btn"
          disabled={!this.hasChanged() || this.state.isUpdating}
          onClick={this.sendUpdate}
        >
          Submit
        </button>
        <button
          className="records-table__action-row__dismiss-link"
          onClick={() => this.setState({
            updatedResource: cloneResource(this.props.resource) || makeDefaultResource(),
            isDirty: false,
            importReview: null,
            errorMessage: '',
          })}
          disabled={!this.hasChanged() || this.state.isUpdating}
        >
          Discard Changes
        </button>
      </TableRow>
    );
  }

  renderRefreshStatus() {
    if (!this.props.editable) return null;

    const isRefreshing = this.props.canonicalLoading || this.state.isRefreshingRecords;
    const error = this.state.refreshError || this.props.canonicalError;
    return (
      <div className={cn('records-table__refresh-status', {
        'records-table__refresh-status--error': error,
      })}>
        <div className="records-table__refresh-status__message">
          {error
            ? `Bob could not refresh canonical records: ${error}. The editable draft has not been changed.`
            : isRefreshing
              ? 'Refreshing canonical records from the name tree…'
              : this.state.isDirty
                ? 'Unsaved record changes are preserved. Discard them before refreshing.'
                : 'Records shown here come from the canonical name tree.'}
        </div>
        <button
          className="records-table__refresh-status__button"
          onClick={this.refreshRecords}
          disabled={this.state.isDirty || isRefreshing || this.state.isUpdating || this.state.isImporting}
        >
          {isRefreshing ? 'Refreshing…' : 'Refresh records'}
        </button>
      </div>
    );
  }

  renderImportReview() {
    const review = this.state.importReview;
    if (!review) return null;

    const renderResource = (resource, label) => (
      <div className="activate-import-review__resource">
        <h4>{label} <span>{resource.records.length} record{resource.records.length === 1 ? '' : 's'}</span></h4>
        {resource.records.length === 0
          ? <div className="activate-import-review__empty">No records</div>
          : resource.records.map((record, index) => (
            <div className="activate-import-review__record" key={`${label}-${record.type}-${index}`}>
              <b>{record.type}</b>
              <code>{record.type === 'TXT' ? (record.txt || []).map(value => JSON.stringify(value)).join(' ') : serializeRecord(record)}</code>
            </div>
          ))}
      </div>
    );

    return (
      <section className="activate-import-review" aria-label="LearnHNS proposal review">
        <div className="activate-import-review__header">
          <div>
            <strong>LearnHNS activation proposal staged</strong>
            <p>Review only. Import did not unlock, sign, broadcast, or update this name. Submit remains a separate wallet action.</p>
          </div>
          <span>v{review.proposal.version}</span>
        </div>
        <div className="activate-import-review__grid">
          {renderResource(review.beforeResource, 'Canonical before')}
          {renderResource(review.afterResource, 'Complete result')}
        </div>
      </section>
    );
  }

  renderPendingUpdateOverlay() {
    const {t} = this.context;
    return (
      <div className="records-table__pending-overlay">
        <div className="records-table__pending-overlay__content">{t('updatingRecords')}</div>
      </div>
    );
  }

  renderTransferringOverlay() {
    const {t} = this.context;
    return (
      <div className="records-table__pending-overlay">
        <div className="records-table__pending-overlay__content">{t('updateDuringTransfer')}</div>
      </div>
    );
  }

  renderTreeUpdateInfo() {
    const {t} = this.context;
    const { currentHeight } = this.props;
    const network = Network.get(this.props.network);
    const { treeInterval } = network.names;

    // Next Tree Update Block (w.r.t. current height)
    let block = currentHeight + (treeInterval - (currentHeight % treeInterval));
    let text = 'treeUpdateGeneric';

    // If last transaction was an UPDATE, then relative block
    const { height, covenant } = this.props.domain?.lastTx || {};
    if (
      height &&
      (covenant.action === 'UPDATE' || covenant.action === 'REGISTER')
    ) {
      block = height + (treeInterval - (height % treeInterval));

      text =
        currentHeight < block
          ? 'treeUpdateFuture'
          : 'treeUpdatePast';
    }

    return (
      <div className="tree-update">
        {t(text)} {block} (<Blocktime height={block} fromNow prefix />)
      </div>
    );
  }

  renderHeaders() {
    return (
      <HeaderRow>
        <HeaderItem>
          <div>Type</div>
        </HeaderItem>
        <HeaderItem>
          Value
        </HeaderItem>
        <HeaderItem>
          {this.renderTreeUpdateInfo()}
        </HeaderItem>
      </HeaderRow>
    );
  }

  render() {
    const {t} = this.context;
    const {
      editable,
      pendingData,
      transferring,
      domain = {},
      resource
    } = this.props;

    const isCanonicalLoading = editable
      && (this.props.canonicalLoading || this.state.isRefreshingRecords)
      && !this.state.isDirty
      && !this.state.updatedResource.records.length;
    const canonicalError = this.state.refreshError || this.props.canonicalError;

    if (!editable && (!resource || !resource.records.length)) {
      return <div className="auction-panel__header__content">{t('none')}</div>
    }

    if (isCanonicalLoading || (editable && canonicalError && !this.state.updatedResource.records.length && !this.state.isDirty)) {
      return this.renderRefreshStatus();
    }

    return (
      <div>
        {this.renderRefreshStatus()}
        {this.renderImportReview()}
        <Table
          className={cn('records-table', {
            'records-table--pending': pendingData,
          })}
        >
          {this.renderHeaders()}
          {this.renderRows()}
          {(!pendingData && editable) ? this.renderCreateRecord() : null}
          {(!pendingData && editable) ? this.renderActionRow() : null}
          {pendingData ? this.renderPendingUpdateOverlay() : null}
          {transferring || domain.pendingOperation === 'TRANSFER' ? this.renderTransferringOverlay() : null}
        </Table>
      </div>
    );
  }
}

export default withRouter(
  connect(
    (state, ownProps) => {
      const domain = state.names[ownProps.name];
      const resource = getDecodedResource(domain);
      const deeplinkParams = state.app.deeplinkParams;

      return {
        domain,
        resource,
        pendingData: getPendingData(domain),
        currentHeight: state.node.chain.height,
        network: state.wallet.network,
        deeplinkParams,
      };
    },
    (dispatch, ownProps) => ({
      sendUpdate: (name, json) => dispatch(nameActions.sendUpdate(name, json)),
      showSuccess: (message) => dispatch(showSuccess(message)),
      clearDeeplinkParams: () => dispatch(clearDeeplinkParams()),
      loadCanonicalNameInfo: name => nodeClient.getNameInfo(name),
      refreshCanonicalNameInfo: ownProps.refreshCanonicalNameInfo
        || (name => dispatch(nameActions.getNameInfo(name))),
      openProposalFile: options => dialog.showOpenDialog(options),
      readProposalFile: path => fs.promises.readFile(path),
    }),
  )(Records),
);

function getDecodedResource(domain) {
  const {info} = domain || {};

  if (!info) {
    return;
  }

  const {data} = info;

  if (!data) {
    return;
  }

  return {
    records: [],
    ...Resource.decode(new Buffer(data, 'hex')).toJSON(),
  };
}

function getPendingData(domain) {
  if (!domain) {
    return null;
  }

  if (domain.pendingOperation === 'UPDATE' || domain.pendingOperation === 'REGISTER') {
    return getDecodedResource({
      info: {
        data: domain.pendingOperationMeta.data,
      },
    });
  }

  return null;
}
