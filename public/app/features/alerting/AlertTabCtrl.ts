import _ from 'lodash';
import coreModule from 'app/core/core_module';
import { ThresholdMapper } from './state/ThresholdMapper';
import { QueryPart } from 'app/core/components/query_part/query_part';
import alertDef from './state/alertDef';
import config from 'app/core/config';
import appEvents from 'app/core/app_events';
import { BackendSrv } from 'app/core/services/backend_srv';
import { DashboardSrv } from '../dashboard/services/DashboardSrv';
import DatasourceSrv from '../plugins/datasource_srv';
import { DataQuery } from '@grafana/data';
import { PanelModel } from 'app/features/dashboard/state';
import { getDefaultCondition } from './getAlertingValidationMessage';
import { CoreEvents } from 'app/types';
import { VariableSrv } from '../templating/variable_srv';
import { IQService, ITimeoutService } from 'angular';
import { VariableActions, VariableModel, VariableWithOptions } from '../templating/variable';

interface ConditionModel {
  source: any;
  type: string;
  queryPart: QueryPart;
  reducerPart: QueryPart;
  evaluator: any;
  operator: any;
  variables: { [key: string]: VariableWithOptions };
}

export class AlertTabCtrl {
  panel: PanelModel;
  panelCtrl: any;
  subTabIndex: number;
  conditionTypes: any;
  alert: any;
  conditionModels: ConditionModel[];
  evalFunctions: any;
  evalOperators: any;
  noDataModes: any;
  executionErrorModes: any;
  addNotificationSegment: any;
  notifications: any;
  alertNotifications: any;
  error: string;
  appSubUrl: string;
  alertHistory: any;
  newAlertRuleTag: any;

  /** @ngInject */
  constructor(
    private $scope: any,
    private backendSrv: BackendSrv,
    private dashboardSrv: DashboardSrv,
    private uiSegmentSrv: any,
    private $q: IQService,
    private $timeout: ITimeoutService,
    private datasourceSrv: DatasourceSrv,
    private variableSrv: VariableSrv
  ) {
    this.alert = $scope.alert;
    this.panelCtrl = $scope.ctrl;
    this.panel = this.panelCtrl.panel;
    this.$scope.ctrl = this;
    this.subTabIndex = 0;
    this.evalFunctions = alertDef.evalFunctions;
    this.evalOperators = alertDef.evalOperators;
    this.conditionTypes = alertDef.conditionTypes;
    this.noDataModes = alertDef.noDataModes;
    this.executionErrorModes = alertDef.executionErrorModes;
    this.appSubUrl = config.appSubUrl;
  }

  $onInit() {
    this.addNotificationSegment = this.uiSegmentSrv.newPlusButton();

    // subscribe to graph threshold handle changes
    const thresholdChangedEventHandler = this.graphThresholdChanged.bind(this);
    this.panelCtrl.events.on(CoreEvents.thresholdChanged, thresholdChangedEventHandler);

    // set panel alert edit mode
    this.$scope.$on('$destroy', () => {
      this.panelCtrl.events.off(CoreEvents.thresholdChanged, thresholdChangedEventHandler);
      this.panelCtrl.editingThresholds = false;
      this.panelCtrl.render();
    });

    // build notification model
    this.notifications = [];
    this.alertNotifications = [];
    this.alertHistory = [];

    return this.backendSrv.get('/api/alert-notifications/lookup').then((res: any) => {
      this.notifications = res;

      // An empty alert mean a new alert
      if (_.isEmpty(this.alert)) {
        this.enable();
      } else {
        this.initModel();
      }
      this.validateModel();
    });
  }

  getAlertHistory() {
    this.backendSrv
      .get(`/api/annotations?dashboardId=${this.panelCtrl.dashboard.id}&panelId=${this.panel.id}&limit=50&type=alert`)
      .then((res: any) => {
        this.alertHistory = _.map(res, ah => {
          ah.time = this.dashboardSrv.getCurrent().formatDate(ah.time, 'MMM D, YYYY HH:mm:ss');
          ah.stateModel = alertDef.getStateDisplayModel(ah.newState);
          ah.info = alertDef.getAlertAnnotationInfo(ah);
          return ah;
        });
      });
  }

  getNotificationIcon(type: string): string {
    switch (type) {
      case 'email':
        return 'fa fa-envelope';
      case 'slack':
        return 'fa fa-slack';
      case 'victorops':
        return 'fa fa-pagelines';
      case 'webhook':
        return 'fa fa-cubes';
      case 'pagerduty':
        return 'fa fa-bullhorn';
      case 'opsgenie':
        return 'fa fa-bell';
      case 'hipchat':
        return 'fa fa-mail-forward';
      case 'pushover':
        return 'fa fa-mobile';
      case 'kafka':
        return 'fa fa-random';
      case 'teams':
        return 'fa fa-windows';
    }
    return 'fa fa-bell';
  }

  getNotifications() {
    return this.$q.when(
      this.notifications.map((item: any) => {
        return this.uiSegmentSrv.newSegment(item.name);
      })
    );
  }

  notificationAdded() {
    const model: any = _.find(this.notifications, {
      name: this.addNotificationSegment.value,
    });
    if (!model) {
      return;
    }

    this.alertNotifications.push({
      name: model.name,
      iconClass: this.getNotificationIcon(model.type),
      isDefault: false,
      uid: model.uid,
    });

    // avoid duplicates using both id and uid to be backwards compatible.
    if (!_.find(this.alert.notifications, n => n.id === model.id || n.uid === model.uid)) {
      this.alert.notifications.push({ uid: model.uid });
    }

    // reset plus button
    this.addNotificationSegment.value = this.uiSegmentSrv.newPlusButton().value;
    this.addNotificationSegment.html = this.uiSegmentSrv.newPlusButton().html;
    this.addNotificationSegment.fake = true;
  }

  removeNotification(an: any) {
    // remove notifiers refeered to by id and uid to support notifiers added
    // before and after we added support for uid
    _.remove(this.alert.notifications, (n: any) => n.uid === an.uid || n.id === an.id);
    _.remove(this.alertNotifications, (n: any) => n.uid === an.uid || n.id === an.id);
  }

  addAlertRuleTag() {
    if (this.newAlertRuleTag.name) {
      this.alert.alertRuleTags[this.newAlertRuleTag.name] = this.newAlertRuleTag.value;
    }
    this.newAlertRuleTag.name = '';
    this.newAlertRuleTag.value = '';
  }

  removeAlertRuleTag(tagName: string) {
    delete this.alert.alertRuleTags[tagName];
  }

  initModel() {
    const alert = this.alert;
    if (!alert) {
      return;
    }

    alert.conditions = alert.conditions || [];
    if (alert.conditions.length === 0) {
      alert.conditions.push(getDefaultCondition());
    }

    alert.noDataState = alert.noDataState || config.alertingNoDataOrNullValues;
    alert.executionErrorState = alert.executionErrorState || config.alertingErrorOrTimeout;
    alert.frequency = alert.frequency || '1m';
    alert.handler = alert.handler || 1;
    alert.notifications = alert.notifications || [];
    alert.for = alert.for || '0m';
    alert.alertRuleTags = alert.alertRuleTags || {};

    const defaultName = this.panel.title + ' alert';
    alert.name = alert.name || defaultName;

    this.conditionModels = _.reduce(
      alert.conditions,
      (memo, value) => {
        memo.push(this.buildConditionModel(value));
        return memo;
      },
      []
    );

    ThresholdMapper.alertToGraphThresholds(this.panel);

    for (const addedNotification of alert.notifications) {
      // lookup notifier type by uid
      let model: any = _.find(this.notifications, { uid: addedNotification.uid });

      // fallback to using id if uid is missing
      if (!model) {
        model = _.find(this.notifications, { id: addedNotification.id });
      }

      if (model && model.isDefault === false) {
        model.iconClass = this.getNotificationIcon(model.type);
        this.alertNotifications.push(model);
      }
    }

    for (const notification of this.notifications) {
      if (notification.isDefault) {
        notification.iconClass = this.getNotificationIcon(notification.type);
        notification.bgColor = '#00678b';
        this.alertNotifications.push(notification);
      }
    }

    this.panelCtrl.editingThresholds = true;
    this.panelCtrl.render();
  }

  graphThresholdChanged(evt: any) {
    for (const condition of this.alert.conditions) {
      if (condition.type === 'query') {
        condition.evaluator.params[evt.handleIndex] = evt.threshold.value;
        this.evaluatorParamsChanged();
        break;
      }
    }
  }

  getTarget(condition: any): DataQuery | string | undefined {
    let firstTarget;
    let foundTarget: DataQuery = null;

    if (condition.type !== 'query') {
      return undefined;
    }

    for (const target of this.panel.targets) {
      if (!firstTarget) {
        firstTarget = target;
      }
      if (condition.query.params[0] === target.refId) {
        foundTarget = target;
        break;
      }
    }

    if (!foundTarget) {
      if (firstTarget) {
        condition.query.params[0] = firstTarget.refId;
        foundTarget = firstTarget;
      } else {
        return 'Could not find any metric queries';
      }
    }

    return foundTarget;
  }

  validateModel() {
    if (!this.alert) {
      return;
    }

    if (!_.isArray(this.alert.conditions)) {
      return;
    }
    const tasks = this.alert.conditions
      .map((condition: any) => {
        const foundTarget = this.getTarget(condition);
        if (_.isNull(foundTarget)) {
          return undefined;
        } else if (_.isString(foundTarget)) {
          return this.$q.reject(foundTarget);
        }
        const datasourceName = foundTarget.datasource || this.panel.datasource;
        return this.datasourceSrv.get(datasourceName).then(ds => {
          if (!ds.meta.alerting) {
            return this.$q.reject('The datasource does not support alerting queries');
          } else {
            return this.$q.resolve();
          }
        });
      })
      .filter((e?: any) => e);
    this.$q.all(tasks).then(
      () => {
        this.error = '';
        this.$timeout(() => this.$scope.$apply());
      },
      (e: any) => {
        this.error = e;
        this.$timeout(() => this.$scope.$apply());
      }
    );
  }

  buildConditionModel(source: any): ConditionModel {
    const condition: ConditionModel = {
      source: source,
      type: source.type,
      queryPart: new QueryPart(source.query, alertDef.alertQueryDef),
      reducerPart: alertDef.createReducerPart(source.reducer),
      evaluator: source.evaluator,
      operator: source.operator,
      variables: {},
    };
    this.setupVariables(condition);
    return condition;
  }

  setupVariables(condition: ConditionModel) {
    const target = this.getTarget(condition.source);
    if (_.isObject(target)) {
      const datasourceName = target.datasource || this.panel.datasource;
      this.datasourceSrv.get(datasourceName).then(ds => {
        const names = ds.getTemplateVariables ? ds.getTemplateVariables(target) : [];
        const variables = names.map(name => {
          const raw = this.getVariable(name);
          const variable = _.clone(raw);
          condition.source.variables = condition.source.variables || {};
          variable.unlink();
          variable.current = condition.source.variables[name] =
            condition.source.variables[name] || _.cloneDeep(raw.current);
          variable.options = _.cloneDeep(raw.options);
          return variable;
        });
        condition.variables = _.zipObject(names, variables);
        this.$timeout(() => this.$scope.$apply());
      });
    }
  }

  updateVariables(conditionModel: ConditionModel, name: string) {
    conditionModel.source.variables[name] = {
      ...conditionModel.variables[name].current,
    };
    const target = this.getTarget(conditionModel.source);
    if (_.isObject(target)) {
      const datasourceName = target.datasource || this.panel.datasource;
      this.datasourceSrv.get(datasourceName).then(ds => {
        if (ds.interpolateVariablesInQueries) {
          const [query] = ds.interpolateVariablesInQueries([target], conditionModel.variables);
          conditionModel.source.query.model = query;
        }
      });
    }
  }

  handleQueryPartEvent(conditionModel: any, evt: any) {
    switch (evt.name) {
      case 'action-remove-part': {
        break;
      }
      case 'get-part-actions': {
        return this.$q.when([]);
      }
      case 'part-param-changed': {
        this.setupVariables(conditionModel);
        this.validateModel();
      }
      case 'get-param-options': {
        const result = this.panel.targets.map(target => {
          return this.uiSegmentSrv.newSegment({ value: target.refId });
        });

        return this.$q.when(result);
      }
    }
    return undefined;
  }

  handleReducerPartEvent(conditionModel: any, evt: any) {
    switch (evt.name) {
      case 'action': {
        conditionModel.source.reducer.type = evt.action.value;
        conditionModel.reducerPart = alertDef.createReducerPart(conditionModel.source.reducer);
        break;
      }
      case 'get-part-actions': {
        const result = [];
        for (const type of alertDef.reducerTypes) {
          if (type.value !== conditionModel.source.reducer.type) {
            result.push(type);
          }
        }
        return this.$q.when(result);
      }
    }
    return undefined;
  }

  addCondition(type: string) {
    const condition = getDefaultCondition();
    // add to persited model
    this.alert.conditions.push(condition);
    // add to view model
    this.conditionModels.push(this.buildConditionModel(condition));
  }

  removeCondition(index: number) {
    this.alert.conditions.splice(index, 1);
    this.conditionModels.splice(index, 1);
  }

  enable = () => {
    this.initModel();
    this.alert.for = '5m'; //default value for new alerts. for existing alerts we use 0m to avoid breaking changes
  };

  evaluatorParamsChanged() {
    ThresholdMapper.alertToGraphThresholds(this.panel);
    this.panelCtrl.render();
  }

  evaluatorTypeChanged(evaluator: any) {
    // ensure params array is correct length
    switch (evaluator.type) {
      case 'lt':
      case 'gt': {
        evaluator.params = [evaluator.params[0]];
        break;
      }
      case 'within_range':
      case 'outside_range': {
        evaluator.params = [evaluator.params[0], evaluator.params[1]];
        break;
      }
      case 'no_value': {
        evaluator.params = [];
      }
    }

    this.evaluatorParamsChanged();
  }

  clearHistory() {
    appEvents.emit(CoreEvents.showConfirmModal, {
      title: 'Delete Alert History',
      text: 'Are you sure you want to remove all history & annotations for this alert?',
      icon: 'fa-trash',
      yesText: 'Yes',
      onConfirm: () => {
        this.backendSrv
          .post('/api/annotations/mass-delete', {
            dashboardId: this.panelCtrl.dashboard.id,
            panelId: this.panel.id,
          })
          .then(() => {
            this.alertHistory = [];
            this.panelCtrl.refresh();
          });
      },
    });
  }

  getVariable(name: string): VariableWithOptions & VariableActions {
    return this.variableSrv.variables.find((e: VariableModel) => e.name === name);
  }
}

/** @ngInject */
export function alertTab() {
  'use strict';
  return {
    restrict: 'E',
    scope: true,
    templateUrl: 'public/app/features/alerting/partials/alert_tab.html',
    controller: AlertTabCtrl,
  };
}

coreModule.directive('alertTab', alertTab);
