import React, { Component } from 'react';
import PropTypes from 'prop-types';
import c from 'classnames';
import WizardHeader from '../../../components/WizardHeader';
import './select-node-mode.scss';

const SPV = 'spv';
const FULL = 'full';

export default class SelectNodeMode extends Component {
  static propTypes = {
    currentStep: PropTypes.number.isRequired,
    totalSteps: PropTypes.number.isRequired,
    onBack: PropTypes.func.isRequired,
    onNext: PropTypes.func.isRequired,
    onCancel: PropTypes.func.isRequired,
    isLoading: PropTypes.bool,
  };

  static defaultProps = {
    isLoading: false,
  };

  state = {
    mode: SPV,
  };

  onSubmit = () => {
    this.props.onNext(this.state.mode === SPV);
  };

  renderOption(mode, title, subtitle, meta) {
    const selected = this.state.mode === mode;

    return (
      <button
        type="button"
        className={c('select-node-mode__option', {
          'select-node-mode__option--selected': selected,
        })}
        onClick={() => this.setState({mode})}
      >
        <span className="select-node-mode__option-check" />
        <span className="select-node-mode__option-copy">
          <span className="select-node-mode__option-title">{title}</span>
          <span className="select-node-mode__option-subtitle">{subtitle}</span>
          <span className="select-node-mode__option-meta">{meta}</span>
        </span>
      </button>
    );
  }

  render() {
    const {currentStep, totalSteps, onBack, onCancel, isLoading} = this.props;

    return (
      <div className="select-node-mode">
        <WizardHeader
          currentStep={currentStep}
          totalSteps={totalSteps}
          onBack={onBack}
          onCancel={onCancel}
        />
        <div className="select-node-mode__content">
          <div className="select-node-mode__header-text">
            Choose node mode
          </div>
          <div className="select-node-mode__body-text">
            SPV mode is recommended for most users. You can run a full node if you prefer local full-chain verification.
          </div>
          <div className="select-node-mode__options">
            {this.renderOption(
              SPV,
              'SPV mode',
              'Lightweight wallet mode with faster setup and lower disk usage.',
              'Recommended'
            )}
            {this.renderOption(
              FULL,
              'Full node',
              'Downloads and verifies the full Handshake chain on this computer.',
              'Uses more time, bandwidth, and disk space'
            )}
          </div>
        </div>
        <div className="select-node-mode__footer">
          <button
            className="extension_cta_button create_cta"
            onClick={this.onSubmit}
            disabled={isLoading}
          >
            {isLoading ? 'Applying...' : 'Continue'}
          </button>
        </div>
      </div>
    );
  }
}
