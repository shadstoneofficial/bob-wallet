import {reviewText} from '../../utils/reviewText';
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
import ListingForm from '../../addons/shakex/ListingForm';
import {buildSaleReview} from '../../addons/shakex/records';
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

  tr = (key, ...values) => reviewText(this.context.t, key, ...values);

  assertCurrent = (review, hex) => {
    try {
      assertCanonicalStillCurrent(review, hex);
    } catch (error) {
      throw new Error(this.tr('recordsStale'));
    }
  };

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
      resourceWallet: props.walletId,
      resourceGeneration: props.walletGeneration,
      resourceNetwork: props.network,
      isDirty: false,
      isRefreshingRecords: false,
      refreshError: '',
      importReview: null,
      isImporting: false,
    };
  }

  static getDerivedStateFromProps(props, state) {
    const nameChanged = props.name !== state.resourceName || props.walletId !== state.resourceWallet || props.walletGeneration !== state.resourceGeneration || props.network !== state.resourceNetwork;
    const canonicalChanged = !deepEqual(props.resource || null, state.canonicalResource);
    let nextState = null;

    if (nameChanged) {
      const canonicalResource = cloneResource(props.resource);
      nextState = {
        resourceName: props.name,
        resourceWallet: props.walletId,
        resourceGeneration: props.walletGeneration,
        resourceNetwork: props.network,
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
      const submitName = this.props.name;
      const submitNetwork = this.props.network;
      const submitWallet = this.props.walletId;
      const submitGeneration = this.props.walletGeneration;
      const review = this.state.importReview;
      const assertContext = () => {
        if (this.props.name !== submitName || this.props.network !== submitNetwork || this.props.walletId !== submitWallet || this.props.walletGeneration !== submitGeneration) {
          throw new Error(this.tr('recordsContextChanged'));
        }
      };
      const recheckSale = review?.kind === 'shakex' ? async () => {
        assertContext();
        if (!this.props.domain?.isOwner || this.props.pendingData || this.props.transferring || this.props.domain.pendingOperation) throw new Error(this.tr('recordsUnavailable'));
        const latest = await this.props.loadCanonicalNameInfo(submitName);
        assertContext();
        if (!latest?.info || latest.info.transfer || latest.info.revoked) throw new Error(this.tr('recordsUnavailable'));
        this.assertCurrent(review, latest.info.data || '00');
      } : undefined;
      if (this.state.importReview?.kind === 'shakex' && (!this.props.domain?.isOwner || this.props.pendingData || this.props.transferring || this.props.domain.pendingOperation)) {
        throw new Error(this.tr('recordsConfirmOwnership'));
      }
      if (review) {
        const result = await this.props.loadCanonicalNameInfo(this.props.name);
        if (!result || !result.info) throw new Error(this.tr('recordsReloadFailed'));
        assertContext();
        if (review.kind === 'shakex' && (result.info.transfer || result.info.revoked)) {
          throw new Error(this.tr('recordsTransferring'));
        }
        this.assertCurrent(review, result.info.data || '00');
      }
      if (this.props.name !== submitName || this.props.network !== submitNetwork) {
        throw new Error(this.tr('recordsContextChanged'));
      }
      const res = await this.props.sendUpdate(submitName, updatedResource, recheckSale);
      this.setState({
        isUpdating: false,
        ...(res !== null ? {isDirty: false, importReview: null} : {}),
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
        refreshError: error.message || this.tr('recordsRefreshFailed'),
      });
    }
  };

  onStageSale = async options => {
    if (!this.props.domain?.isOwner || this.props.pendingData || this.props.transferring ||
        this.props.domain.pendingOperation || this.state.isDirty || this.state.isUpdating || this.state.isImporting) {
      this.setState({errorMessage: this.tr('shakexPendingOrDirty')});
      return;
    }
    const name = this.props.name;
    const network = this.props.network;
    const wallet = this.props.walletId;
    const generation = this.props.walletGeneration;
    this.setState({isImporting: true, errorMessage: ''});
    try {
      const result = await this.props.loadCanonicalNameInfo(name);
      if (this.props.name !== name || this.props.network !== network || this.props.walletId !== wallet || this.props.walletGeneration !== generation) return;
      if (!result?.info || !this.props.domain?.isOwner || this.props.domain.pendingOperation || this.props.transferring || this.props.pendingData) {
        throw new Error(this.tr('recordsUpdateUnavailable'));
      }
      if (result.info.transfer || result.info.revoked) throw new Error(this.tr('recordsTransferring'));
      const importReview = buildSaleReview(result.info.data || '00', options, this.context.t);
      this.setState({importReview, updatedResource: importReview.afterResource, isDirty: true});
    } catch (error) {
      if (this.props.name === name) this.setState({errorMessage: error.message});
    } finally {
      this.setState({isImporting: false});
    }
  };

  onImportProposal = async () => {
    if (!this.props.domain || !this.props.domain.isOwner) {
      this.setState({errorMessage: this.tr('recordsImportOwnerOnly')});
      return;
    }
    if (this.props.pendingData) {
      this.setState({errorMessage: this.tr('recordsImportPending')});
      return;
    }

    this.setState({isImporting: true, errorMessage: ''});
    try {
      const result = await this.props.openProposalFile({
        properties: ['openFile'],
        filters: [{name: this.tr('recordsProposalFile'), extensions: ['json']}],
      });
      if (result.canceled || !result.filePaths || !result.filePaths[0]) {
        this.setState({isImporting: false});
        return;
      }

      const contents = await this.props.readProposalFile(result.filePaths[0]);
      const nameInfo = await this.props.loadCanonicalNameInfo(this.props.name);
      if (!nameInfo || !nameInfo.info) throw new Error(this.tr('recordsLoadFailed'));
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
            disabled={!this.props.domain || !this.props.domain.isOwner || this.state.isImporting || this.state.importReview?.kind === 'shakex'}
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
        disabled={!this.props.domain || !this.props.domain.isOwner || this.state.isImporting || this.state.importReview?.kind === 'shakex'}
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
          disabled={this.state.isImporting || this.state.isUpdating || Boolean(this.props.pendingData) || this.state.importReview?.kind === 'shakex'}
          onClick={this.onImportProposal}
        >
          {this.state.isImporting ? this.tr('recordsImporting') : this.tr('recordsImport')}
        </button>
        <button
          className="records-table__action-row__submit-btn"
          disabled={!this.hasChanged() || this.state.isUpdating || this.state.isImporting}
          onClick={this.sendUpdate}
        >
          {this.tr('recordsSubmit')}
        </button>
        <button
          className="records-table__action-row__dismiss-link"
          onClick={() => this.setState({
            updatedResource: cloneResource(this.props.resource) || makeDefaultResource(),
            isDirty: false,
            importReview: null,
            errorMessage: '',
          })}
          disabled={!this.hasChanged() || this.state.isUpdating || this.state.isImporting}
        >
          {this.tr('recordsDiscard')}
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
            ? this.tr('recordsRefreshError', error)
            : isRefreshing
              ? this.tr('recordsRefreshingCanonical')
              : this.state.isDirty
                ? this.tr('recordsPreservedDraft')
                : this.tr('recordsCanonicalNotice')}
        </div>
        <button
          className="records-table__refresh-status__button"
          onClick={this.refreshRecords}
          disabled={this.state.isDirty || isRefreshing || this.state.isUpdating || this.state.isImporting}
        >
          {isRefreshing ? this.tr('recordsRefreshing') : this.tr('recordsRefresh')}
        </button>
      </div>
    );
  }

  renderImportReview() {
    const review = this.state.importReview;
    if (!review) return null;

    const renderResource = (resource, label) => (
      <div className="activate-import-review__resource">
        <h4>{label} <span>{this.tr(resource.records.length === 1 ? 'recordsCountOne' : 'recordsCountMany', resource.records.length)}</span></h4>
        {resource.records.length === 0
          ? <div className="activate-import-review__empty">{this.tr('recordsEmpty')}</div>
          : resource.records.map((record, index) => (
            <div className="activate-import-review__record" key={`${label}-${record.type}-${index}`}>
              <b>{record.type}</b>
              <code>{record.type === 'TXT' ? (record.txt || []).map(value => JSON.stringify(value)).join(' ') : serializeRecord(record)}</code>
            </div>
          ))}
      </div>
    );

    return (
      <section className={cn("activate-import-review", {"activate-import-review--shakex": review.kind === "shakex"})} aria-label={review.kind === "shakex" ? this.tr('shakexReviewAriaLabel') : this.tr('recordsReviewAriaLabel')}>
        <div className="activate-import-review__header">
          <div>
            <strong>{review.kind === 'shakex' ? this.tr('shakexReviewTitle') : this.tr('recordsReviewTitle')}</strong>
            <p>{this.tr('recordsReviewHelp')}</p>
          </div>
          <span>{review.kind === 'shakex' ? this.tr('shakexResourceBytes', review.bytes) : `v${review.proposal.version}`}</span>
        </div>
        <div className="activate-import-review__grid">
          {renderResource(review.beforeResource, this.tr('recordsBefore'))}
          {renderResource(review.afterResource, this.tr('recordsAfter'))}
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
          <div>{this.tr('recordsType')}</div>
        </HeaderItem>
        <HeaderItem>
          {this.tr('recordsValue')}
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
        {editable && domain.isOwner && <ListingForm
          key={this.props.name}
          resource={resource}
          disabled={this.state.isDirty || this.state.isImporting || this.state.isUpdating || !!pendingData || transferring || !!domain.pendingOperation}
          onStage={this.onStageSale}
        />}
        {this.renderImportReview()}
        <Table
          className={cn('records-table', {
            'records-table--pending': pendingData,
            'records-table--shakex': editable && domain.isOwner,
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
        walletId: state.wallet.wid,
        walletGeneration: state.wallet.requestGeneration || 0,
        deeplinkParams,
      };
    },
    (dispatch, ownProps) => ({
      sendUpdate: (name, json, beforeSend) => dispatch(nameActions.sendUpdate(name, json, beforeSend)),
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
