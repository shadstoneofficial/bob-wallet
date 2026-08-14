import React, { Component } from 'react';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
import isValidAddress from '../../utils/verifyAddress';
import { I18nContext } from '../../utils/i18n';
import hip2 from "../../utils/hip2Client";
import {normalizeHostname} from '../../background/hip2/alias';
import Alert from '../Alert';
import LockSVG from '../../assets/images/lock.svg';
import RingsSVG from '../../assets/images/rings.svg';
import './address-input.scss';


export class AddressInput extends Component {
  resolveOnNextChange = false;

  static propTypes = {
    isSynchronized: PropTypes.bool.isRequired,
    noDns: PropTypes.bool.isRequired,
    hip2Port: PropTypes.number.isRequired,
    network: PropTypes.string.isRequired,
    onAddress: PropTypes.func,
  };

  static contextType = I18nContext;

  constructor(props) {
    super(props);

    this.state = {
      input: '',
      address: '',
      loading: false,
      errorMessage: '',
    };

    hip2.setServers([`127.0.0.1:${props.hip2Port}`]);
  }

  handleEscape = (event) => {
    if (this.state.input && event.key === 'Escape') {
      this.resetInput();
    }
  }

  componentDidMount = () => {
    document.addEventListener('keydown', this.handleEscape);
    this.props.onAddress?.({
      domain: '',
      address: ''
    });
  }

  componentDidUpdate = (previousProps) => {
    if (previousProps.hip2Port !== this.props.hip2Port) {
      hip2.setServers([`127.0.0.1:${this.props.hip2Port}`]);
    }
  }

  componentWillUnmount = () => {
    document.removeEventListener('keydown', this.handleEscape);
  }

  _resolveHip2Address = async (input) => {
    const {t} = this.context;
    const {network, onAddress} = this.props;

    try {
      const addr = await hip2.fetchAddress(input);

      // prevent latency attacks
      const currentInput = this.state.input.slice(1);
      if (input !== currentInput) return;

      const isValid = addr.length < 3 || isValidAddress(addr, network);
      this.setState({
        loading: false,
        address: addr,
        errorMessage: !isValid ? t('invalidAddress') : '',
      });
      onAddress?.({
        domain: normalizeHostname(currentInput),
        address: isValid ? addr : '',
      });
    } catch (error) {
      // prevent latency attacks
      const currentInput = this.state.input.slice(1);
      if (input !== currentInput) return;

      const {code} = error;
      const errorText = {
        EINVALID: t('hip2InvalidAddress'),
        ELARGE: t('hip2InvalidAddress'),
        ECOLLISION: t('hip2AmbiguousAlias'),
        EINVALIDALIAS: t('hip2InvalidAlias'),
        ETLSAMISMATCH: t('hip2TLSAMismatch'),
        ETXTINSECURE: t('hip2TXTInsecure'),
        EINSECURE: t('hip2InvalidTLSA'),
        ENOTFOUND: t('hip2ConnectionFailed'),
        EAI_AGAIN: t('hip2ConnectionFailed'),
        ECONNREFUSED: t('hip2ConnectionFailed'),
        ECONNRESET: t('hip2ConnectionFailed'),
        ETIMEOUT: t('hip2ConnectionFailed'),
        ETIMEDOUT: t('hip2ConnectionFailed'),
        EDNS: t('hip2DNSFailed'),
      }[code] || t('hip2AddressNotFound');

      this.setState({loading: false, errorMessage: errorText});
      onAddress?.({domain: '', address: ''});
    }
  }

  resolveCurrentHip2Address = () => {
    const {input, loading, address} = this.state;

    if (!input.startsWith('@') || input.length === 1 || loading || address) {
      return;
    }

    const hostname = input.slice(1);
    this.setState({loading: true, errorMessage: ''}, () => {
      this._resolveHip2Address(hostname);
    });
  }

  handleInputChange = (event) => {
    const resolveImmediately = this.resolveOnNextChange
      || event.nativeEvent?.inputType === 'insertFromPaste';

    this.resolveOnNextChange = false;
    this.onInputChange(event.target.value, resolveImmediately);
  }

  handlePaste = () => {
    this.resolveOnNextChange = true;
  }

  handleInputKeyDown = (event) => {
    if (event.key === 'Backspace') {
      this.resetInput();
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      this.resolveCurrentHip2Address();
    }
  }

  onInputChange = (input, resolveImmediately = false) => {
    const {t} = this.context;
    const {isSynchronized, noDns, network, onAddress} = this.props;

    const oldInput = this.state.input;
    const oldIsHip2Input = oldInput.startsWith('@');

    // HIP-2 -> HIP-2:
    if (oldIsHip2Input) {
      input = '@' + input;
    }

    const isHip2Input = input.startsWith('@');
    const trimmedInput = isHip2Input ? input.slice(1) : input;

    // regular -> HIP-2:
    if (!oldIsHip2Input && isHip2Input) {
      this.setState({input: input});
    }

    // Clear field if empty
    if (!trimmedInput) {
      this.setState({
        input: input,
        address: '',
        loading: false,
        errorMessage: '',
      });
      onAddress?.({domain: '', address: ''});
      return;
    }

    // resolve regular
    if (!isHip2Input) {
      const isValid = isValidAddress(input, network);
      this.setState({
        input: input,
        address: input,
        loading: false,
        errorMessage: !(input.length < 3 || isValid) ? t('invalidAddress') : '',
      });
      onAddress?.({domain: '', address: isValid ? input : ''});
      return;
    }

    // Do not resolve HIP-2 if
    // we are still syncing or DNS isn't enabled
    const isHip2Disabled = noDns || !isSynchronized;
    if (isHip2Disabled) {
      this.setState({
        input: input,
        address: '',
        loading: false,
        errorMessage: '',
      });
      onAddress?.({domain: '', address: ''});
      return;
    };

    // Keep typed aliases pending until Enter or blur. Pasted aliases resolve
    // immediately because the paste operation supplies the complete value.
    this.setState({
      input: input,
      address: '',
      loading: false,
      errorMessage: '',
    }, () => {
      if (resolveImmediately) {
        this.resolveCurrentHip2Address();
      }
    });
    onAddress?.({domain: '', address: ''});
  }

  resetInput = () => {
    const {onAddress} = this.props;
    const {input} = this.state;
    if (input === '@') {
      this.setState({input: '', address: '', loading: false, errorMessage: ''});
      onAddress?.({domain: '', address: ''});
    }
  }

  render() {
    const {t} = this.context;
    const {noDns, isSynchronized} = this.props;
    const {input, address, loading, errorMessage} = this.state;

    const isHip2Input = input.startsWith('@');
    const trimmedInput = isHip2Input ? input.slice(1) : input;

    let placeholder = t('recipientAddressHip2Enabled');

    if (isHip2Input) {
      placeholder = t('recipientHip2Address');
    }
    if (!isSynchronized) {
      placeholder = t('recipientAddressHip2Syncing');
    }
    if (noDns) {
      placeholder = t('recipientAddress');
    }

    return (
      <div className="addr-input">
        <div className="addr-input__input">
          {/* HIP-2: Loading/Lock icon */}
          {isHip2Input &&
            <span className="addr-input__prefix">
              {address ?
                <img src={LockSVG} />
                : loading ?
                  <img src={RingsSVG} />
                  : '@'
              }
            </span>
          }

          {/* Input field */}
          <input
            type="text"
            value={trimmedInput}
            onChange={this.handleInputChange}
            onKeyDown={this.handleInputKeyDown}
            onPaste={this.handlePaste}
            onBlur={this.resolveCurrentHip2Address}
            placeholder={placeholder}
            spellCheck="false"
          />
        </div>

        {/* Error */}
        <Alert type="error" message={errorMessage} />

        {/* HIP-2: address */}
        {isHip2Input &&
          <Alert type="info" message={address && `↪ ${address}`} />
        }
      </div>
    );
  }
}

export default connect(
  state => ({
    isSynchronized: state.node.isRunning && (state.node.chain || {}).progress >= 0.999,
    noDns: state.node.noDns,
    hip2Port: state.hip2.port,
    network: state.wallet.network,
  })
)(AddressInput);
