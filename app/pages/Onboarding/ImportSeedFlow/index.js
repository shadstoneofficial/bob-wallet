import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { withRouter } from 'react-router-dom';
import { connect } from 'react-redux';

import ImportSeedWarning from '../ImportSeedWarning/index';
import CreatePassword from '../CreatePassword/index';
import ImportSeedEnterMnemonic from '../ImportSeedEnterMnemonic/index';
import ImportSeedEnterMaster from '../ImportSeedEnterMaster/index';
import Terms from '../Terms/index';
import * as walletActions from '../../../ducks/walletActions';
import walletClient from '../../../utils/walletClient';
import * as logger from '../../../utils/logClient';
import OptInAnalytics from '../OptInAnalytics';
import { clientStub as aClientStub } from '../../../background/analytics/client';
import { clientStub as nClientStub } from '../../../background/node/client';
import { showError } from '../../../ducks/notifications';
import SetName from '../SetName';
import SelectWalletType from '../SelectWalletType';
import SelectNodeMode from '../SelectNodeMode';
import SelectRescanStrategy from '../SelectRescanStrategy';

const analytics = aClientStub(() => require('electron').ipcRenderer);
const nodeClient = nClientStub(() => require('electron').ipcRenderer);

const TERMS_OF_USE = 0;
const WARNING_STEP = 1;
const SET_NAME = 2;
const SELECT_WALLET_TYPE = 3;
const CREATE_PASSWORD = 4;
const ENTRY_STEP = 5;
const OPT_IN_ANALYTICS = 6;
const SELECT_NODE_MODE = 7;
const SELECT_RESCAN_STRATEGY = 8;

const TOTAL_STEPS = 8;

class ImportSeedFlow extends Component {
  static propTypes = {
    history: PropTypes.shape({
      push: PropTypes.func,
    }).isRequired,
    match: PropTypes.shape({
      params: PropTypes.shape({
        type: PropTypes.string.isRequired,
      }),
    }),
    completeInitialization: PropTypes.func.isRequired,
    network: PropTypes.string.isRequired,
    startWalletSync: PropTypes.func.isRequired,
    waitForWalletSync: PropTypes.func.isRequired,
    showError: PropTypes.func.isRequired,
    fetchWallet: PropTypes.func.isRequired,
    fetchTransactions: PropTypes.func.isRequired,
  };

  state = {
    currentStep: TERMS_OF_USE,
    name: '',
    m: null,
    n: null,
    passphrase: '',
    secret: '',
    isLoading: false,
  };

  render() {
    const {history, match} = this.props;
    const {type} = match.params;
    const {currentStep, isLoading} = this.state;

    switch (currentStep) {
      case TERMS_OF_USE:
        return (
          <Terms
            currentStep={currentStep}
            totalSteps={TOTAL_STEPS}
            onAccept={() => this.goTo(WARNING_STEP)}
            onBack={() => history.push('/existing-options')}
          />
        );
      case WARNING_STEP:
        return (
          <ImportSeedWarning
            currentStep={currentStep}
            totalSteps={TOTAL_STEPS}
            onBack={() => this.goTo(TERMS_OF_USE)}
            onNext={() => this.goTo(SET_NAME)}
            onCancel={() => history.push('/funding-options')}
          />
        );
      case SET_NAME:
        return (
          <SetName
            currentStep={currentStep}
            totalSteps={TOTAL_STEPS}
            onBack={() => this.goTo(WARNING_STEP)}
            onNext={(name) => {
              this.setState({currentStep: SELECT_WALLET_TYPE, name});
            }}
            onCancel={() => history.push('/funding-options')}
          />
        );
      case SELECT_WALLET_TYPE:
        return (
          <SelectWalletType
            currentStep={currentStep}
            totalSteps={TOTAL_STEPS}
            onBack={() => this.goTo(SET_NAME)}
            onNext={async (m, n) => {
              this.setState({
                currentStep: CREATE_PASSWORD,
                m, n,
              });
            }}
            onCancel={() => this.props.history.push('/funding-options')}
          />
        );
      case CREATE_PASSWORD:
        return (
          <CreatePassword
            currentStep={currentStep}
            totalSteps={TOTAL_STEPS}
            onBack={() => this.goTo(SELECT_WALLET_TYPE)}
            onNext={passphrase => {
              this.setState({
                currentStep: ENTRY_STEP,
                passphrase,
              });
            }}
            onCancel={() => history.push('/funding-options')}
          />
        );
      case ENTRY_STEP:
        const InputComponent = type === 'master' ? ImportSeedEnterMaster : ImportSeedEnterMnemonic;
        return (
          <InputComponent
            currentStep={currentStep}
            totalSteps={TOTAL_STEPS}
            onBack={() => this.goTo(CREATE_PASSWORD)}
            onNext={(secret) => {
              this.setState({
                secret,
                currentStep: OPT_IN_ANALYTICS,
              });
            }}
            onCancel={() => history.push('/funding-options')}
            type={type}
          />
        );
      case OPT_IN_ANALYTICS:
        return (
          <OptInAnalytics
            currentStep={currentStep}
            totalSteps={TOTAL_STEPS}
            onBack={() => this.goTo(ENTRY_STEP)}
            onNext={async (optInState) => {
              await analytics.setOptIn(optInState);
              this.goTo(SELECT_NODE_MODE);
            }}
            onCancel={() => history.push('/funding-options')}
            isLoading={isLoading}
          />
        );
      case SELECT_NODE_MODE:
        return (
          <SelectNodeMode
            currentStep={currentStep}
            totalSteps={TOTAL_STEPS}
            onBack={() => this.goTo(OPT_IN_ANALYTICS)}
            onNext={async (spv) => {
              if (spv) {
                this.goTo(SELECT_RESCAN_STRATEGY);
                return;
              }

              await this.applyNodeModeAndFinish(false, 0);
            }}
            onCancel={() => history.push('/funding-options')}
            isLoading={isLoading}
          />
        );
      case SELECT_RESCAN_STRATEGY:
        return (
          <SelectRescanStrategy
            currentStep={currentStep}
            totalSteps={TOTAL_STEPS}
            onBack={() => this.goTo(SELECT_NODE_MODE)}
            onNext={async (rescanHeight) => {
              await this.applyNodeModeAndFinish(true, rescanHeight);
            }}
            onCancel={() => history.push('/funding-options')}
            isLoading={isLoading}
          />
        );
    }
  }

  goTo(currentStep) {
    this.setState({
      currentStep,
    });
  }

  finishFlow = async (rescanHeight = 0) => {
    const {type} = this.props.match.params;
    const {name, passphrase, secret, m, n} = this.state;

    this.setState({isLoading: true});
    try {
      await walletClient.importSeed(name, passphrase, type, secret, m, n);
      walletClient.rescan(rescanHeight);
      await this.props.completeInitialization(name, passphrase);
      await this.props.fetchWallet();
      await this.props.fetchTransactions();
      this.props.history.push('/overview');
    } catch (e) {
      this.props.showError(e.message);
      logger.error(`Error received from ImportSeedFlow - finishFlow]\n\n${e.message}\n${e.stack}\n`);
      this.setState({isLoading: false});
    }
  };

  applyNodeMode = async (spv) => {
    this.setState({isLoading: true});
    const currentSpv = await nodeClient.getSpvMode();
    await nodeClient.setSpvMode(spv);

    if (currentSpv !== spv) {
      await nodeClient.reset();
    }
  };

  applyNodeModeAndFinish = async (spv, rescanHeight) => {
    try {
      await this.applyNodeMode(spv);
      await this.finishFlow(rescanHeight);
    } catch (e) {
      this.props.showError(e.message);
      logger.error(`Error received from ImportSeedFlow - applyNodeModeAndFinish]\n\n${e.message}\n${e.stack}\n`);
      this.setState({isLoading: false});
    }
  };
}

export default withRouter(
  connect(
    (state) => ({
      network: state.wallet.network,
    }),
    dispatch => ({
      completeInitialization: (name, passphrase) => dispatch(walletActions.completeInitialization(name, passphrase)),
      waitForWalletSync: () => dispatch(walletActions.waitForWalletSync()),
      startWalletSync: () => dispatch(walletActions.startWalletSync()),
      showError: (message) => dispatch(showError(message)),
      fetchWallet: () => dispatch(walletActions.fetchWallet()),
      fetchTransactions: () => dispatch(walletActions.fetchTransactions()),
    }),
  )(ImportSeedFlow),
);
